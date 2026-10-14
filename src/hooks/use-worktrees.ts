import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  head: string;
  locked: boolean;
  prunable: boolean;
}

/**
 * Lista os git worktrees do projeto carregado (`git worktree list`, só
 * leitura) pra alimentar o seletor no header. Silenciosamente vazio
 * quando o projeto não é um repo git ou não tem `git` disponível — o
 * seletor de worktree é um extra, não algo que deva quebrar o carregamento
 * do manifest.
 */
export function useWorktrees(projectRoot: string | null) {
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);

  useEffect(() => {
    if (!projectRoot) {
      setWorktrees([]);
      return;
    }
    let cancelled = false;
    invoke<WorktreeEntry[]>("list_worktrees", { projectRoot })
      .then((result) => {
        if (!cancelled) setWorktrees(result);
      })
      .catch(() => {
        if (!cancelled) setWorktrees([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  return worktrees;
}
