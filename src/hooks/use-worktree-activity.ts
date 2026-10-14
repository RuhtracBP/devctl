import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Action, ExitEvent, OutputEvent } from "@/types";
import type { WorktreeEntry } from "@/hooks/use-worktrees";
import { containerStatusTone, findColumn, parseAlignedTable } from "@/lib/parse-table";

// Roda N vezes por ciclo (uma por worktree) — intervalo maior que o do
// StatusPanel (5s) pra não empilhar processos de docker toda hora.
const POLL_INTERVAL_MS = 10_000;

/** `null` = ainda não checou / não deu pra saber. */
export type ActivityMap = Record<string, boolean | null>;

function hasRunningContainer(output: string): boolean {
  const table = parseAlignedTable(output);
  if (!table) return false;
  const statusCol = findColumn(table.headers, "status", "state");
  if (statusCol === -1) return false;
  return table.rows.some((row) => containerStatusTone(row[statusCol] ?? "") === "up");
}

/**
 * Pra cada worktree do projeto, reroda a MESMA action de status (a
 * primeira `status_check = true` do manifest — convenção: é a que
 * reflete o estado específico daquele worktree, tipo `docker compose
 * ps` de app/web; uma action de infra compartilhada entre worktrees
 * daria o mesmo resultado em todas e não serviria pra diferenciar)
 * com o `project_root` de cada worktree, pra saber quais têm
 * containers de pé. Usado só pro indicador do seletor de worktree —
 * não é uma verdade geral de status, só "tem algo rodando aqui".
 */
export function useWorktreeActivity(worktrees: WorktreeEntry[], statusAction: Action | null) {
  const [activity, setActivity] = useState<ActivityMap>({});

  const worktreePathsKey = worktrees.map((w) => w.path).join("\n");

  useEffect(() => {
    if (!statusAction || worktrees.length === 0) {
      setActivity({});
      return;
    }

    let cancelled = false;
    const timers: number[] = [];
    const unlistens: Promise<() => void>[] = [];

    setActivity(Object.fromEntries(worktrees.map((w) => [w.path, null])));

    for (const worktree of worktrees) {
      let buffer: string[] = [];
      let currentRunId: string | null = null;

      const unlistenOutput = listen<OutputEvent>("action://output", (event) => {
        if (event.payload.run_id !== currentRunId) return;
        buffer.push(event.payload.line);
      });
      const unlistenExit = listen<ExitEvent>("action://exit", (event) => {
        if (event.payload.run_id !== currentRunId || cancelled) return;
        setActivity((prev) => ({ ...prev, [worktree.path]: hasRunningContainer(buffer.join("\n")) }));
        if (!cancelled) {
          timers.push(window.setTimeout(poll, POLL_INTERVAL_MS));
        }
      });
      unlistens.push(unlistenOutput, unlistenExit);

      async function poll() {
        if (cancelled) return;
        buffer = [];
        try {
          currentRunId = await invoke<string>("run_action", {
            input: {
              project_root: worktree.path,
              action: statusAction,
              param_values: {},
              toggle_mode: null,
            },
          });
        } catch {
          if (cancelled) return;
          setActivity((prev) => ({ ...prev, [worktree.path]: null }));
          timers.push(window.setTimeout(poll, POLL_INTERVAL_MS));
        }
      }

      poll();
    }

    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
      unlistens.forEach((p) => p.then((fn) => fn()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktreePathsKey, statusAction?.id]);

  return activity;
}
