//! Runner de execução das actions do manifest.
//!
//! Único lugar do devctl que roda um script `.sh` de verdade. Regras (ver
//! `docs/manifest-schema.md`, seção "Regras de execução"):
//!
//! 1. `params` viram argv posicionais, na ordem declarada, depois do argv
//!    fixo que o `mode` (toggle) já implica.
//! 2. Nenhum param é interpolado em shell — sempre `Vec<String>` direto pro
//!    `Command`, nunca `sh -c "..."`.
//! 3. `script` roda com `cwd` = raiz do projeto host (onde está o
//!    `dev-app.toml`).

use crate::manifest::{Action, Mode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

/// Estado global: processos em execução, indexados por `run_id`, pra
/// permitir cancelar (`stream`/`toggle`) de fora do task que os criou.
#[derive(Default)]
pub struct RunningProcesses(Mutex<HashMap<String, Child>>);

#[derive(Debug, Deserialize)]
pub struct RunActionInput {
    pub project_root: String,
    pub action: Action,
    #[serde(default)]
    pub param_values: HashMap<String, String>,
    /// Obrigatório quando `action.mode == Toggle`: "run" | "start" | "stop" | "status".
    #[serde(default)]
    pub toggle_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OutputEvent {
    pub run_id: String,
    pub stream: &'static str, // "stdout" | "stderr"
    pub line: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExitEvent {
    pub run_id: String,
    pub code: Option<i32>,
    pub success: bool,
}

pub(crate) fn build_args(action: &Action, param_values: &HashMap<String, String>, toggle_mode: Option<&str>) -> Result<Vec<String>, String> {
    let mut args = Vec::new();

    if action.mode == Mode::Toggle {
        let toggle = action
            .toggle
            .as_ref()
            .ok_or_else(|| format!("action '{}' é toggle mas não tem [toggle] no manifest", action.id))?;
        let sub_arg = match toggle_mode {
            Some("run") => &toggle.run_arg,
            Some("start") => &toggle.start_arg,
            Some("stop") => &toggle.stop_arg,
            Some("status") => &toggle.status_arg,
            Some(other) => return Err(format!("toggle_mode inválido: '{other}' (use run/start/stop/status)")),
            None => return Err("action é toggle, mas toggle_mode não foi informado".into()),
        };
        args.push(sub_arg.clone());
    }

    for param in &action.params {
        let value = param_values
            .get(&param.name)
            .cloned()
            .or_else(|| param.default.clone())
            .unwrap_or_default();

        if value.is_empty() {
            if param.required {
                return Err(format!("param obrigatório '{}' não foi preenchido", param.label));
            }
            continue;
        }

        if param.kind == crate::manifest::ParamKind::Enum && !param.options.iter().any(|o| o == &value) {
            return Err(format!(
                "valor '{value}' inválido pro param '{}' (opções: {})",
                param.label,
                param.options.join(", ")
            ));
        }

        if param.split_shell_words {
            args.extend(value.split_whitespace().map(str::to_string));
        } else {
            args.push(value);
        }
    }

    Ok(args)
}

/// Dispara a execução de uma action e retorna o `run_id` imediatamente —
/// o progresso (stdout/stderr, exit code) chega pro frontend via eventos
/// `action://output` e `action://exit`.
#[tauri::command]
pub async fn run_action(
    app: AppHandle,
    state: State<'_, RunningProcesses>,
    input: RunActionInput,
) -> Result<String, String> {
    if input.action.mode == Mode::Interactive {
        return Err("mode 'interactive' ainda não é suportado pelo devctl (ver docs/roadmap.md)".into());
    }

    let args = build_args(&input.action, &input.param_values, input.toggle_mode.as_deref())?;

    let script_path = PathBuf::from(&input.project_root).join(&input.action.script);
    if !script_path.exists() {
        return Err(format!("script não encontrado: {}", script_path.display()));
    }

    let run_id = uuid::Uuid::new_v4().to_string();

    // Roda via `sh <script>` em vez de exec direto: o padrão que os próprios
    // scripts do projeto host já assumem (um `menu.sh` típico faz
    // `sh "$SCRIPT_DIR/$script_name"`), e não depende do bit de execução do
    // arquivo estar setado — vários scripts reais não têm.
    let mut child = tokio::process::Command::new("sh")
        .arg(&script_path)
        .args(&args)
        .current_dir(&input.project_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("falha ao iniciar '{}': {e}", script_path.display()))?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    spawn_stream_forwarder(app.clone(), run_id.clone(), "stdout", stdout);
    spawn_stream_forwarder(app.clone(), run_id.clone(), "stderr", stderr);

    state.0.lock().unwrap().insert(run_id.clone(), child);

    let run_id_for_wait = run_id.clone();
    tauri::async_runtime::spawn(async move {
        wait_and_emit_exit(app, run_id_for_wait).await;
    });

    Ok(run_id)
}

// `State<'_, T>` carrega um lifetime preso ao invoke atual, então não dá
// pra levar pro task em background — em vez disso, o task pega o
// `AppHandle` ('static, `Clone`) e resolve o estado de novo lá dentro via
// `app.state()`.
async fn wait_and_emit_exit(app: AppHandle, run_id: String) {
    use tauri::Manager;
    let state = app.state::<RunningProcesses>();

    // Tira o child do map só pra dar `.wait()`; se não achar (já foi
    // cancelado/removido), não tem o que esperar.
    let child = { state.0.lock().unwrap().remove(&run_id) };
    let Some(mut child) = child else { return };

    let status = child.wait().await;
    let (code, success) = match status {
        Ok(status) => (status.code(), status.success()),
        Err(_) => (None, false),
    };

    let _ = app.emit(
        "action://exit",
        ExitEvent {
            run_id,
            code,
            success,
        },
    );
}

fn spawn_stream_forwarder<R>(app: AppHandle, run_id: String, stream: &'static str, reader: R)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app.emit(
                "action://output",
                OutputEvent {
                    run_id: run_id.clone(),
                    stream,
                    line,
                },
            );
        }
    });
}

/// Mata o processo de um `run_id` em andamento (ações `stream`, ou
/// `toggle` disparado em foreground). Sem efeito se já terminou.
#[tauri::command]
pub async fn cancel_action(state: State<'_, RunningProcesses>, run_id: String) -> Result<(), String> {
    let mut child = {
        let mut guard = state.0.lock().unwrap();
        guard.remove(&run_id)
    };
    if let Some(child) = child.as_mut() {
        child.kill().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{Param, ParamKind, Toggle};

    fn action_with_params(params: Vec<Param>) -> Action {
        Action {
            id: "test".into(),
            label: "Test".into(),
            category: "test".into(),
            script: "scripts/test.sh".into(),
            mode: Mode::Instant,
            params,
            confirm: false,
            confirm_message: None,
            long_running: false,
            status_check: false,
            toggle: None,
            notes: None,
        }
    }

    fn string_param(name: &str, required: bool) -> Param {
        Param {
            name: name.into(),
            label: name.into(),
            kind: ParamKind::String,
            options: vec![],
            required,
            default: None,
            split_shell_words: false,
        }
    }

    #[test]
    fn params_viram_argv_na_ordem_declarada() {
        let action = action_with_params(vec![string_param("a", true), string_param("b", true)]);
        let values = HashMap::from([("a".to_string(), "1".to_string()), ("b".to_string(), "2".to_string())]);
        assert_eq!(build_args(&action, &values, None).unwrap(), vec!["1", "2"]);
    }

    #[test]
    fn param_opcional_vazio_e_omitido() {
        let action = action_with_params(vec![string_param("a", false)]);
        assert_eq!(build_args(&action, &HashMap::new(), None).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn param_obrigatorio_vazio_da_erro() {
        let action = action_with_params(vec![string_param("a", true)]);
        assert!(build_args(&action, &HashMap::new(), None).is_err());
    }

    #[test]
    fn enum_com_valor_fora_das_options_da_erro() {
        let action = action_with_params(vec![Param {
            name: "env".into(),
            label: "Ambiente".into(),
            kind: ParamKind::Enum,
            options: vec!["dev".into(), "prod".into()],
            required: true,
            default: None,
            split_shell_words: false,
        }]);
        let values = HashMap::from([("env".to_string(), "staging".to_string())]);
        assert!(build_args(&action, &values, None).is_err());
    }

    #[test]
    fn split_shell_words_quebra_o_valor_em_multiplos_argv() {
        let action = action_with_params(vec![Param {
            split_shell_words: true,
            ..string_param("args", true)
        }]);
        let values = HashMap::from([("args".to_string(), "migrate --seed".to_string())]);
        assert_eq!(build_args(&action, &values, None).unwrap(), vec!["migrate", "--seed"]);
    }

    #[test]
    fn toggle_prefixa_o_sub_arg_antes_dos_params() {
        let mut action = action_with_params(vec![string_param("a", true)]);
        action.mode = Mode::Toggle;
        action.toggle = Some(Toggle {
            run_arg: "run".into(),
            start_arg: "start".into(),
            stop_arg: "stop".into(),
            status_arg: "status".into(),
        });
        let values = HashMap::from([("a".to_string(), "1".to_string())]);
        assert_eq!(
            build_args(&action, &values, Some("start")).unwrap(),
            vec!["start", "1"]
        );
    }

    #[test]
    fn toggle_sem_toggle_mode_da_erro() {
        let mut action = action_with_params(vec![]);
        action.mode = Mode::Toggle;
        action.toggle = Some(Toggle {
            run_arg: "run".into(),
            start_arg: "start".into(),
            stop_arg: "stop".into(),
            status_arg: "status".into(),
        });
        assert!(build_args(&action, &HashMap::new(), None).is_err());
    }
}
