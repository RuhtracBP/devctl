import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Action } from "@/types";
import { usePtySession } from "@/hooks/use-pty-session";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface TerminalDialogProps {
  action: Action;
  projectRoot: string;
  paramValues: Record<string, string>;
  onClose: () => void;
}

/**
 * Terminal embutido pras actions `mode = "interactive"` (ex.
 * `docker compose exec app sh`). O devctl é dono do PTY (backend, ver
 * `src-tauri/src/pty.rs`) — diferente de abrir o Terminal.app, aqui o
 * app tem acesso total ao que passa pela sessão.
 */
export function TerminalDialog({
  action,
  projectRoot,
  paramValues,
  onClose,
}: TerminalDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  const { closed, error, write, resize } = usePtySession(
    { project_root: projectRoot, action, param_values: paramValues },
    (bytes) => termRef.current?.write(bytes),
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      theme: { background: "#0b0b0f", foreground: "#e6e6e6" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    const onData = term.onData((data) => write(data));

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      resize(term.rows, term.cols);
    });
    resizeObserver.observe(containerRef.current);
    resize(term.rows, term.cols);

    return () => {
      onData.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (closed) {
      termRef.current?.write("\r\n\x1b[2m(sessão encerrada)\x1b[0m\r\n");
    }
  }, [closed]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[32rem] max-w-[calc(100%-2rem)] flex-col gap-2 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {action.label}
            {closed && <Badge variant="destructive">sessão encerrada</Badge>}
          </DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden rounded-lg bg-[#0b0b0f] p-2" />
        )}
      </DialogContent>
    </Dialog>
  );
}
