//! Parser do manifest `dev-app.toml`. Ver `docs/manifest-schema.md` pro
//! schema documentado — este módulo é o espelho em Rust dele.
//!
//! Nenhuma lógica de Docker/git mora aqui: isto só desserializa o TOML e
//! valida invariantes estruturais (ids únicos, campos condicionais
//! presentes). Execução dos scripts é responsabilidade de outro módulo
//! (`runner`, ainda não implementado).

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fmt;
use std::path::Path;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Manifest {
    pub app: AppMeta,
    #[serde(default, rename = "actions")]
    pub actions: Vec<Action>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AppMeta {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub scripts_root: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Action {
    pub id: String,
    pub label: String,
    pub category: String,
    pub script: String,
    pub mode: Mode,
    #[serde(default)]
    pub params: Vec<Param>,
    #[serde(default)]
    pub confirm: bool,
    #[serde(default)]
    pub confirm_message: Option<String>,
    #[serde(default)]
    pub long_running: bool,
    /// Dica pra UI: esta action é uma consulta de status somente-leitura
    /// (ex. `docker compose ps`) e pode virar um painel com refresh
    /// automático em vez de um item de menu que só roda sob demanda.
    #[serde(default)]
    pub status_check: bool,
    #[serde(default)]
    pub toggle: Option<Toggle>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Instant,
    Stream,
    Interactive,
    Toggle,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Toggle {
    pub run_arg: String,
    pub start_arg: String,
    pub stop_arg: String,
    pub status_arg: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Param {
    pub name: String,
    pub label: String,
    #[serde(rename = "type")]
    pub kind: ParamKind,
    #[serde(default)]
    pub options: Vec<String>,
    pub required: bool,
    #[serde(default)]
    pub default: Option<String>,
    /// Quando true, o valor digitado é dividido em múltiplos argv por
    /// espaço em branco (`split_whitespace`, sem parsing de aspas) em vez
    /// de virar um único argv. Existe pra params tipo "argumentos livres
    /// de CLI" (ex. `artisan.sh` espera "$@" com um argv por token —
    /// "migrate --seed" precisa virar dois argv, não um só com espaço).
    #[serde(default)]
    pub split_shell_words: bool,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum ParamKind {
    String,
    Enum,
}

#[derive(Debug)]
pub enum ValidationError {
    DuplicateId(String),
    MissingToggle(String),
    MissingConfirmMessage(String),
    EnumWithoutOptions { action: String, param: String },
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DuplicateId(id) => write!(f, "id de action duplicado: '{id}'"),
            Self::MissingToggle(id) => {
                write!(f, "action '{id}' tem mode = \"toggle\" mas não declara [actions.toggle]")
            }
            Self::MissingConfirmMessage(id) => {
                write!(f, "action '{id}' tem confirm = true mas não declara confirm_message")
            }
            Self::EnumWithoutOptions { action, param } => write!(
                f,
                "action '{action}', param '{param}': type = \"enum\" mas 'options' está vazio"
            ),
        }
    }
}

impl std::error::Error for ValidationError {}

impl Manifest {
    /// Carrega e valida um manifest a partir de um caminho de arquivo.
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let raw = std::fs::read_to_string(path)?;
        let manifest: Manifest = toml::from_str(&raw)?;
        manifest.validate()?;
        Ok(manifest)
    }

    /// Invariantes estruturais que o `serde` sozinho não garante.
    fn validate(&self) -> Result<(), ValidationError> {
        let mut seen = HashSet::new();
        for action in &self.actions {
            if !seen.insert(action.id.clone()) {
                return Err(ValidationError::DuplicateId(action.id.clone()));
            }
            if action.mode == Mode::Toggle && action.toggle.is_none() {
                return Err(ValidationError::MissingToggle(action.id.clone()));
            }
            if action.confirm && action.confirm_message.is_none() {
                return Err(ValidationError::MissingConfirmMessage(action.id.clone()));
            }
            for param in &action.params {
                if param.kind == ParamKind::Enum && param.options.is_empty() {
                    return Err(ValidationError::EnumWithoutOptions {
                        action: action.id.clone(),
                        param: param.name.clone(),
                    });
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example_path() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../examples/laravel-app.dev-app.toml")
    }

    #[test]
    fn loads_the_example_manifest() {
        let manifest = Manifest::load(&example_path()).expect("manifest de exemplo deve ser válido");

        assert_eq!(manifest.app.name, "laravel-app");
        assert_eq!(manifest.actions.len(), 27);

        let toggles: Vec<_> = manifest
            .actions
            .iter()
            .filter(|a| a.mode == Mode::Toggle)
            .map(|a| a.id.as_str())
            .collect();
        assert_eq!(toggles, vec!["yarn-dev", "queue-work"]);

        let status_checks: Vec<_> = manifest
            .actions
            .iter()
            .filter(|a| a.status_check)
            .map(|a| a.id.as_str())
            .collect();
        assert_eq!(status_checks, vec!["status", "infra-status"]);

        let artisan = manifest.actions.iter().find(|a| a.id == "artisan").unwrap();
        assert!(artisan.params[0].split_shell_words);
    }
}
