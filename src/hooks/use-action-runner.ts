import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ExitEvent, OutputEvent, RunActionInput } from "@/types";

export interface RunLine {
  stream: "stdout" | "stderr";
  line: string;
}

export interface RunState {
  runId: string;
  actionLabel: string;
  lines: RunLine[];
  running: boolean;
  exitCode: number | null;
  success: boolean | null;
}

/**
 * Dispara e acompanha MÚLTIPLAS execuções em paralelo (uma aba por
 * `run_id`) — importante pra ações `stream`/`toggle` de longa duração
 * (ex. logs, queue worker em foreground) que o usuário quer deixar
 * rodando enquanto dispara outras coisas. Escuta os eventos globais
 * `action://output` / `action://exit` do backend (`runner.rs`) e roteia
 * cada um pra run certa da lista pelo `run_id`.
 */
export function useActionRunner() {
  const [runs, setRuns] = useState<RunState[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  useEffect(() => {
    const unlistenOutput = listen<OutputEvent>("action://output", (event) => {
      setRuns((prev) =>
        prev.map((r) =>
          r.runId === event.payload.run_id
            ? { ...r, lines: [...r.lines, { stream: event.payload.stream, line: event.payload.line }] }
            : r,
        ),
      );
    });

    const unlistenExit = listen<ExitEvent>("action://exit", (event) => {
      setRuns((prev) =>
        prev.map((r) =>
          r.runId === event.payload.run_id
            ? { ...r, running: false, exitCode: event.payload.code, success: event.payload.success }
            : r,
        ),
      );
    });

    return () => {
      unlistenOutput.then((fn) => fn());
      unlistenExit.then((fn) => fn());
    };
  }, []);

  const start = useCallback(async (input: RunActionInput, actionLabel: string) => {
    const runId = await invoke<string>("run_action", { input });
    setRuns((prev) => [
      ...prev,
      { runId, actionLabel, lines: [], running: true, exitCode: null, success: null },
    ]);
    setActiveRunId(runId);
    return runId;
  }, []);

  const cancel = useCallback(async (runId: string) => {
    await invoke("cancel_action", { runId }).catch(() => {});
  }, []);

  /** Fecha a aba; se ainda estiver rodando, cancela o processo primeiro. */
  const closeRun = useCallback(
    (runId: string) => {
      setRuns((prev) => {
        const target = prev.find((r) => r.runId === runId);
        if (target?.running) {
          invoke("cancel_action", { runId }).catch(() => {});
        }
        const next = prev.filter((r) => r.runId !== runId);
        setActiveRunId((activeId) => {
          if (activeId !== runId) return activeId;
          return next.length > 0 ? next[next.length - 1].runId : null;
        });
        return next;
      });
    },
    [],
  );

  return { runs, activeRunId, setActiveRunId, start, cancel, closeRun };
}
