import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { RunState } from "@/hooks/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ActionRunTabsProps {
  runs: RunState[];
  activeRunId: string | null;
  onSelect: (runId: string) => void;
  onCancel: (runId: string) => void;
  onClose: (runId: string) => void;
}

function statusDotClass(run: RunState): string {
  if (run.running) return "bg-sky-500 animate-pulse";
  if (run.success) return "bg-emerald-500";
  return "bg-red-500";
}

function statusBadge(run: RunState) {
  if (run.running) {
    return <Badge className="bg-sky-500/15 text-sky-600 dark:text-sky-400">rodando…</Badge>;
  }
  if (run.success) {
    return <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">concluído</Badge>;
  }
  return <Badge variant="destructive">falhou (código {run.exitCode ?? "?"})</Badge>;
}

/**
 * Console fixo no rodapé, com uma aba por execução — cada `run_id` (ver
 * `use-action-runner.ts`) vira uma aba independente, o que deixa ações
 * `stream`/`toggle` de longa duração (logs, queue worker em foreground)
 * rodando enquanto o usuário dispara/acompanha outras coisas.
 */
export function ActionRunTabs({ runs, activeRunId, onSelect, onCancel, onClose }: ActionRunTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRun = runs.find((r) => r.runId === activeRunId) ?? runs[runs.length - 1];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeRun?.lines.length]);

  if (runs.length === 0 || !activeRun) return null;

  return (
    <div className="sticky bottom-0 flex flex-col border-t border-border/60 bg-card shadow-lg">
      <div className="flex items-stretch gap-0.5 overflow-x-auto bg-muted/40 px-2 pt-1.5">
        {runs.map((run) => (
          <button
            key={run.runId}
            type="button"
            onClick={() => onSelect(run.runId)}
            className={cn(
              "group flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 border-transparent px-3 py-1.5 text-xs",
              run.runId === activeRun.runId
                ? "border-border/60 bg-card font-medium"
                : "text-muted-foreground hover:bg-background/60",
            )}
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", statusDotClass(run))} />
            <span className="max-w-40 truncate">{run.actionLabel}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onClose(run.runId);
              }}
              className="rounded-sm opacity-0 hover:bg-muted group-hover:opacity-100"
              title="Fechar"
            >
              <X className="size-3" />
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          {activeRun.actionLabel}
          {statusBadge(activeRun)}
        </div>
        {activeRun.running && (
          <Button type="button" variant="destructive" size="sm" onClick={() => onCancel(activeRun.runId)}>
            Cancelar
          </Button>
        )}
      </div>
      <div
        ref={scrollRef}
        className="max-h-48 overflow-y-auto bg-black/90 p-3 font-mono text-xs text-white/90 dark:bg-black/60"
      >
        {activeRun.lines.length === 0 && !activeRun.running && (
          <p className="text-white/40">(sem saída)</p>
        )}
        {activeRun.lines.map((entry, i) => (
          <p key={i} className={entry.stream === "stderr" ? "text-red-400" : undefined}>
            {entry.line}
          </p>
        ))}
      </div>
    </div>
  );
}
