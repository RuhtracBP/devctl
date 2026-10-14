//! Suporte a `mode = "interactive"`: as outras actions rodam com
//! `tokio::process::Command` (ver `runner.rs`) e um pipe simples de
//! stdout/stderr basta, mas um shell interativo (`docker compose exec app
//! sh`) precisa de um TTY real — sem isso, o processo detecta que não tem
//! terminal e se recusa a dar prompt interativo.
//!
//! Aqui o devctl é dono de um PTY de verdade (`portable-pty`) e faz o papel
//! de terminal: manda bytes de input do usuário pro processo, recebe bytes
//! de output e repassa pro xterm.js no frontend renderizar. Igual ao
//! `runner.rs`, nenhuma lógica de Docker/shell mora aqui — só encanamento.

use crate::manifest::Action;
use crate::runner::build_args;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
}

#[derive(Default)]
pub struct PtySessions(Mutex<HashMap<String, PtySession>>);

#[derive(Debug, Deserialize)]
pub struct StartInteractiveInput {
    pub project_root: String,
    pub action: Action,
    #[serde(default)]
    pub param_values: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PtyOutputEvent {
    pub run_id: String,
    /// Bytes crus do PTY (pode ter sequências ANSI, não é UTF-8
    /// garantido), em base64 — o xterm.js escreve isso direto.
    pub data_base64: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PtyExitEvent {
    pub run_id: String,
}

/// Abre um PTY e roda o `script` da action dentro dele. Retorna o
/// `run_id` — o output chega via evento `pty://output`, o fim da sessão
/// via `pty://exit`.
#[tauri::command]
pub async fn start_interactive(
    app: AppHandle,
    state: State<'_, PtySessions>,
    input: StartInteractiveInput,
) -> Result<String, String> {
    let args = build_args(&input.action, &input.param_values, None)?;

    let script_path = PathBuf::from(&input.project_root).join(&input.action.script);
    if !script_path.exists() {
        return Err(format!("script não encontrado: {}", script_path.display()));
    }

    let pty_system = portable_pty::native_pty_system();
    let pair = pty_system
        .openpty(portable_pty::PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("falha ao abrir PTY: {e}"))?;

    // Mesma razão do runner.rs: roda via `sh <script>` (padrão que os
    // próprios scripts do projeto host assumem) em vez de exec direto, que
    // dependeria do bit de execução do arquivo.
    let mut cmd = portable_pty::CommandBuilder::new("sh");
    cmd.arg(&script_path);
    cmd.args(&args);
    cmd.cwd(&input.project_root);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("falha ao iniciar '{}': {e}", script_path.display()))?;
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("falha ao clonar leitor do PTY: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("falha ao pegar writer do PTY: {e}"))?;

    let run_id = uuid::Uuid::new_v4().to_string();

    state.0.lock().unwrap().insert(
        run_id.clone(),
        PtySession {
            writer,
            master: pair.master,
        },
    );

    spawn_reader_thread(app.clone(), run_id.clone(), reader);
    spawn_wait_thread(app, run_id.clone(), child);

    Ok(run_id)
}

fn spawn_reader_thread(app: AppHandle, run_id: String, mut reader: Box<dyn Read + Send>) {
    // `Read::read` bloqueia — não dá pra usar a runtime async do tokio
    // sem um wrapper, então isso roda numa thread de SO comum mesmo.
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF: processo fechou o lado dele do PTY
                Ok(n) => {
                    let data_base64 = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app.emit(
                        "pty://output",
                        PtyOutputEvent {
                            run_id: run_id.clone(),
                            data_base64,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });
}

fn spawn_wait_thread(app: AppHandle, run_id: String, mut child: Box<dyn portable_pty::Child + Send + Sync>) {
    std::thread::spawn(move || {
        let _ = child.wait();
        let _ = app.emit("pty://exit", PtyExitEvent { run_id });
    });
}

/// Envia input do usuário (o que ele digitou no xterm.js) pro processo.
#[tauri::command]
pub fn write_to_pty(state: State<'_, PtySessions>, run_id: String, data: String) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    let session = guard.get_mut(&run_id).ok_or("sessão de terminal não encontrada")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())
}

/// Redimensiona o PTY quando a janela/painel do terminal muda de tamanho.
#[tauri::command]
pub fn resize_pty(state: State<'_, PtySessions>, run_id: String, rows: u16, cols: u16) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    let session = guard.get(&run_id).ok_or("sessão de terminal não encontrada")?;
    session
        .master
        .resize(portable_pty::PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

/// Encerra a sessão (fecha o diálogo do terminal, ou o usuário cancela).
/// Dropar o `PtySession` fecha o master e o writer; o processo filho
/// recebe EOF/SIGHUP e a `spawn_wait_thread` emite `pty://exit` sozinha.
#[tauri::command]
pub fn close_pty(state: State<'_, PtySessions>, run_id: String) -> Result<(), String> {
    state.0.lock().unwrap().remove(&run_id);
    Ok(())
}
