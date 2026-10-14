import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Action, ExitEvent, OutputEvent } from "@/types";

const POLL_INTERVAL_MS = 5000;

export interface StatusResult {
  actionId: string;
  label: string;
  output: string;
  success: boolean | null;
  updatedAt: number | null;
  loading: boolean;
}

/**
 * Roda em loop as actions marcadas `status_check = true` (ex.
 * `docker compose ps`, via o script do projeto host — devctl não sabe
 * nada de Docker, só reroda a action que o manifest já declara) e
 * mantém a última saída de cada uma. Cada action tem seu próprio
 * `run_id`/timer, independente do runner "principal" (o painel de
 * execução do usuário, em `use-action-runner.ts`).
 */
export function useStatusPoll(actions: Action[], projectRoot: string | null) {
  const [results, setResults] = useState<Record<string, StatusResult>>({});

  // IDs em vez de objetos Action inteiros na dependência do effect, pra
  // não reiniciar os pollers só porque o manifest foi recarregado com o
  // mesmo conteúdo (novo array, mesmo id).
  const actionsKey = actions.map((a) => a.id).join(",");

  useEffect(() => {
    if (!projectRoot || actions.length === 0) {
      setResults({});
      return;
    }

    let cancelled = false;
    const timers: number[] = [];
    const unlistens: Promise<() => void>[] = [];

    setResults(
      Object.fromEntries(
        actions.map((a) => [
          a.id,
          {
            actionId: a.id,
            label: a.label,
            output: "",
            success: null,
            updatedAt: null,
            loading: true,
          } satisfies StatusResult,
        ]),
      ),
    );

    for (const action of actions) {
      let buffer: string[] = [];
      let currentRunId: string | null = null;

      const unlistenOutput = listen<OutputEvent>("action://output", (event) => {
        if (event.payload.run_id !== currentRunId) return;
        buffer.push(event.payload.line);
      });
      const unlistenExit = listen<ExitEvent>("action://exit", (event) => {
        if (event.payload.run_id !== currentRunId || cancelled) return;
        setResults((prev) => ({
          ...prev,
          [action.id]: {
            actionId: action.id,
            label: action.label,
            output: buffer.join("\n"),
            success: event.payload.success,
            updatedAt: Date.now(),
            loading: false,
          },
        }));
        if (!cancelled) {
          const timer = window.setTimeout(poll, POLL_INTERVAL_MS);
          timers.push(timer);
        }
      });
      unlistens.push(unlistenOutput, unlistenExit);

      async function poll() {
        if (cancelled) return;
        buffer = [];
        try {
          currentRunId = await invoke<string>("run_action", {
            input: {
              project_root: projectRoot,
              action,
              param_values: {},
              toggle_mode: null,
            },
          });
        } catch (err) {
          if (cancelled) return;
          setResults((prev) => ({
            ...prev,
            [action.id]: {
              actionId: action.id,
              label: action.label,
              output: String(err),
              success: false,
              updatedAt: Date.now(),
              loading: false,
            },
          }));
          const timer = window.setTimeout(poll, POLL_INTERVAL_MS);
          timers.push(timer);
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
  }, [actionsKey, projectRoot]);

  return results;
}
