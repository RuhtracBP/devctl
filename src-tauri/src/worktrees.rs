//! Descoberta de git worktrees do projeto carregado — só leitura, só pra
//! popular um seletor na UI. devctl não cria/remove/gerencia worktrees
//! aqui (isso continua sendo scripts do projeto host, ex.
//! `new-worktree.sh`, invocado como qualquer outra action); isto
//! só chama `git worktree list` e mostra o que já existe.

use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct WorktreeEntry {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub locked: bool,
    pub prunable: bool,
}

/// Lista os worktrees do repositório git que contém `project_root`. Erro
/// (não é um repo git, `git` não está no PATH, etc.) vira `Err` — a UI
/// trata isso como "sem seletor de worktree pra este projeto", não como
/// falha do carregamento do manifest.
#[tauri::command]
pub fn list_worktrees(project_root: String) -> Result<Vec<WorktreeEntry>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&project_root)
        .args(["worktree", "list", "--porcelain"])
        .output()
        .map_err(|e| format!("falha ao rodar 'git worktree list': {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "'git worktree list' falhou: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(parse_porcelain(&String::from_utf8_lossy(&output.stdout)))
}

/// Parser de `git worktree list --porcelain`. Formato: um bloco por
/// worktree, uma linha `worktree <path>` abre o bloco, seguida de `HEAD
/// <sha>`, opcionalmente `branch refs/heads/<nome>` (ausente se
/// detached/bare), e opcionalmente `locked [motivo]` / `prunable [motivo]`.
fn parse_porcelain(text: &str) -> Vec<WorktreeEntry> {
    let mut entries = Vec::new();
    let mut current: Option<WorktreeEntry> = None;

    for line in text.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            current = Some(WorktreeEntry {
                path: path.to_string(),
                branch: None,
                head: String::new(),
                locked: false,
                prunable: false,
            });
            continue;
        }
        let Some(entry) = current.as_mut() else { continue };
        if let Some(head) = line.strip_prefix("HEAD ") {
            entry.head = head.to_string();
        } else if let Some(branch) = line.strip_prefix("branch ") {
            entry.branch = Some(branch.trim_start_matches("refs/heads/").to_string());
        } else if line == "locked" || line.starts_with("locked ") {
            entry.locked = true;
        } else if line == "prunable" || line.starts_with("prunable ") {
            entry.prunable = true;
        }
    }
    if let Some(entry) = current.take() {
        entries.push(entry);
    }

    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_multiplos_worktrees() {
        let text = "\
worktree /repo
HEAD ac54034435e9384de7d07a58b6b68191a967e8e9
branch refs/heads/develop

worktree /repo-wt/feature-x
HEAD 1ea0acc50ee1148fe253402aa6570f791edc0d20
branch refs/heads/feature-x
";
        let entries = parse_porcelain(text);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "/repo");
        assert_eq!(entries[0].branch.as_deref(), Some("develop"));
        assert_eq!(entries[1].path, "/repo-wt/feature-x");
        assert_eq!(entries[1].branch.as_deref(), Some("feature-x"));
    }

    #[test]
    fn detached_head_sem_branch() {
        let text = "worktree /repo\nHEAD ac54034435e9384de7d07a58b6b68191a967e8e9\ndetached\n";
        let entries = parse_porcelain(text);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].branch, None);
    }

    #[test]
    fn locked_e_prunable() {
        let text = "worktree /repo\nHEAD abc\nbranch refs/heads/main\nlocked motivo qualquer\nprunable\n";
        let entries = parse_porcelain(text);
        assert!(entries[0].locked);
        assert!(entries[0].prunable);
    }

    #[test]
    fn texto_vazio_da_lista_vazia() {
        assert_eq!(parse_porcelain(""), Vec::new());
    }
}
