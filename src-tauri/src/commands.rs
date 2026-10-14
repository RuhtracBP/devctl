//! Comandos Tauri expostos pro frontend (`invoke("...")`). Fina camada de
//! tradução entre `manifest::Manifest` e o que a UI React consome — toda
//! lógica de verdade (parse, validação) mora em `manifest.rs`.

use crate::manifest::Manifest;
use std::path::PathBuf;

/// Carrega e valida um `dev-app.toml` a partir de um caminho absoluto.
/// Retorna erro como `String` (Tauri serializa `Err` como rejeição da
/// Promise do lado JS).
#[tauri::command]
pub fn load_manifest(path: String) -> Result<Manifest, String> {
    let manifest = Manifest::load(&PathBuf::from(path)).map_err(|err| err.to_string())?;
    Ok(manifest)
}
