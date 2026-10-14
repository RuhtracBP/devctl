import type { Action } from "@/types";
import { useStatusPoll } from "@/hooks/use-status-poll";
import { containerStatusTone, findColumn, parseAlignedTable, type StatusTone } from "@/lib/parse-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatusPanelProps {
  actions: Action[];
  projectRoot: string | null;
}

const TONE_DOT: Record<StatusTone, string> = {
  up: "bg-emerald-500",
  down: "bg-red-500",
  warn: "bg-amber-500",
};

const TONE_TEXT: Record<StatusTone, string> = {
  up: "text-emerald-600 dark:text-emerald-400",
  down: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
};

function secondsAgo(updatedAt: number | null): string {
  if (updatedAt === null) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  return seconds <= 1 ? "agora" : `há ${seconds}s`;
}

function ContainerChip({ name, status, ports }: { name: string; status: string; ports: string }) {
  const tone = containerStatusTone(status);
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/50 px-2.5 py-2"
      title={ports || undefined}
    >
      <span className={`size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{name}</p>
        <p className={`truncate text-[11px] ${TONE_TEXT[tone]}`}>{status || "—"}</p>
      </div>
    </div>
  );
}

/** Tabela de `docker compose ps` (ou saída parecida) virou grade de chips por container. */
function ContainerGrid({ output }: { output: string }) {
  const table = parseAlignedTable(output);
  if (!table || table.rows.length === 0) return null;

  const nameCol = findColumn(table.headers, "name", "container", "service");
  const statusCol = findColumn(table.headers, "status", "state");
  const portsCol = findColumn(table.headers, "ports", "port");
  if (nameCol === -1 || statusCol === -1) return null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {table.rows.map((row, i) => (
        <ContainerChip
          key={i}
          name={row[nameCol] ?? "?"}
          status={row[statusCol] ?? ""}
          ports={portsCol !== -1 ? row[portsCol] ?? "" : ""}
        />
      ))}
    </div>
  );
}

/**
 * Painel com refresh automático das actions `status_check = true` do
 * manifest (ver docs/roadmap.md). Não fala com Docker/git — só reroda
 * periodicamente a action que o projeto host já declara (ex.
 * `docker compose ps` dentro de `status.sh`) e, quando a saída parece
 * tabular, mostra como chips coloridos por container em vez de texto
 * cru (fallback pro texto cru quando não dá pra parsear).
 */
export function StatusPanel({ actions, projectRoot }: StatusPanelProps) {
  const results = useStatusPoll(actions, projectRoot);

  if (actions.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {actions.map((action) => {
        const result = results[action.id];
        const output = result?.output ?? "";
        const table = parseAlignedTable(output);
        const rendersAsGrid =
          table && table.rows.length > 0 && findColumn(table.headers, "name", "container", "service") !== -1;

        return (
          <Card key={action.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{action.label}</CardTitle>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {result?.loading && (
                  <Badge className="bg-sky-500/15 text-sky-600 dark:text-sky-400">
                    atualizando…
                  </Badge>
                )}
                {result?.success === false && !result.loading && (
                  <Badge variant="destructive">erro</Badge>
                )}
                <span>{secondsAgo(result?.updatedAt ?? null)}</span>
              </div>
            </CardHeader>
            <CardContent>
              {rendersAsGrid ? (
                <ContainerGrid output={output} />
              ) : output.trim() ? (
                <pre className="max-h-40 overflow-auto rounded-lg bg-black/90 p-3 font-mono text-xs whitespace-pre-wrap text-white/90 dark:bg-black/60">
                  {output}
                </pre>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {result?.loading ? "…" : "Nenhum container rodando."}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
