import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PtyExitEvent, PtyOutputEvent, StartInteractiveInput } from "@/types";

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encanamento IPC de uma sessão de terminal embutido (`mode =
 * "interactive"`): abre o PTY no backend, expõe callbacks pro xterm.js
 * escrever bytes recebidos e mandar input do usuário de volta. A
 * renderização em si (o `Terminal` do xterm.js) fica no componente —
 * este hook só cuida do lado Tauri.
 */
export function usePtySession(
  input: StartInteractiveInput,
  onData: (bytes: Uint8Array) => void,
) {
  const [runId, setRunId] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  useEffect(() => {
    let cancelled = false;

    const unlistenOutput = listen<PtyOutputEvent>("pty://output", (event) => {
      if (event.payload.run_id !== runIdRef.current) return;
      onDataRef.current(base64ToBytes(event.payload.data_base64));
    });
    const unlistenExit = listen<PtyExitEvent>("pty://exit", (event) => {
      if (event.payload.run_id !== runIdRef.current) return;
      setClosed(true);
    });

    invoke<string>("start_interactive", { input })
      .then((id) => {
        if (cancelled) {
          invoke("close_pty", { runId: id }).catch(() => {});
          return;
        }
        runIdRef.current = id;
        setRunId(id);
      })
      .catch((err) => setError(String(err)));

    return () => {
      cancelled = true;
      unlistenOutput.then((fn) => fn());
      unlistenExit.then((fn) => fn());
      if (runIdRef.current) {
        invoke("close_pty", { runId: runIdRef.current }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function write(data: string) {
    if (!runIdRef.current) return;
    invoke("write_to_pty", { runId: runIdRef.current, data }).catch(() => {});
  }

  function resize(rows: number, cols: number) {
    if (!runIdRef.current) return;
    invoke("resize_pty", { runId: runIdRef.current, rows, cols }).catch(() => {});
  }

  return { runId, closed, error, write, resize };
}
