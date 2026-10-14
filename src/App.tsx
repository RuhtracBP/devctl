import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { dirname } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import type { Manifest, Action, ToggleMode } from "./types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { ActionRunTabs } from "@/components/action-run-tabs";
import { RunActionDialog } from "@/components/run-action-dialog";
import { StatusPanel } from "@/components/status-panel";
import { WorktreeSelector } from "@/components/worktree-selector";
import { useActionRunner } from "@/hooks/use-action-runner";
import { useWorktrees } from "@/hooks/use-worktrees";
import type { WorktreeEntry } from "@/hooks/use-worktrees";
import { useWorktreeActivity } from "@/hooks/use-worktree-activity";
import { readLastManifestPath, writeLastManifestPath } from "@/lib/last-manifest";

// xterm.js é pesado (~600kB) e só é usado por ações mode="interactive" —
// lazy pra não inflar o bundle inicial de quem nunca abre um terminal.
const TerminalDialog = lazy(() =>
  import("@/components/terminal-dialog").then((m) => ({ default: m.TerminalDialog })),
);

const MODE_LABEL: Record<Action["mode"], string> = {
  instant: "instantâneo",
  stream: "contínuo",
  interactive: "interativo",
  toggle: "background",
};

// Cada mode tem uma cor própria pra escanear a grade rápido; o resto
// (destructive/outline) fica reservado pra estados semânticos (erro, confirm).
const MODE_BADGE_CLASS: Record<Action["mode"], string> = {
  instant: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  stream: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  interactive: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  toggle: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

const TOGGLE_MODES: { mode: ToggleMode; label: string }[] = [
  { mode: "run", label: "Rodar" },
  { mode: "start", label: "Iniciar bg" },
  { mode: "stop", label: "Parar" },
  { mode: "status", label: "Status" },
];

interface QuickActionCardProps {
  action: Action;
  onRun: (action: Action, toggleMode?: ToggleMode) => void;
}

/**
 * Um "quick action" do dashboard: card compacto, botão(ões) sempre à
 * mostra. Nada aqui desabilita por "já tem algo rodando" — execuções são
 * concorrentes agora (cada uma vira uma aba em `ActionRunTabs`), então dá
 * pra disparar uma ação nova mesmo com outras em andamento.
 */
function QuickActionCard({ action, onRun }: QuickActionCardProps) {
  const isInteractive = action.mode === "interactive";

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge className={MODE_BADGE_CLASS[action.mode]}>{MODE_LABEL[action.mode]}</Badge>
        {action.confirm && <Badge variant="destructive">⚠</Badge>}
      </div>

      <div>
        <p className="text-sm font-medium leading-tight">{action.label}</p>
        {action.notes && (
          <p className="mt-1 text-xs text-muted-foreground">{action.notes}</p>
        )}
      </div>

      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
        {isInteractive ? (
          <Button type="button" size="sm" onClick={() => onRun(action)} className="flex-1">
            Abrir terminal
          </Button>
        ) : action.mode === "toggle" ? (
          TOGGLE_MODES.map(({ mode, label }) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onRun(action, mode)}
            >
              {label}
            </Button>
          ))
        ) : (
          <Button
            type="button"
            size="sm"
            variant={action.confirm ? "destructive" : "default"}
            onClick={() => onRun(action)}
            className="flex-1"
          >
            Executar
          </Button>
        )}
      </div>

      <code className="truncate text-[11px] text-muted-foreground/70">{action.script}</code>
    </div>
  );
}

function App() {
  const [manifestPath, setManifestPath] = useState(
    () => readLastManifestPath() ?? "../examples/laravel-app.dev-app.toml",
  );
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingPath, setEditingPath] = useState(true);

  const [pending, setPending] = useState<{ action: Action; toggleMode?: ToggleMode } | null>(null);
  const [interactiveSession, setInteractiveSession] = useState<{
    action: Action;
    paramValues: Record<string, string>;
  } | null>(null);
  const { runs, activeRunId, setActiveRunId, start, cancel, closeRun } = useActionRunner();
  const worktrees = useWorktrees(projectRoot);
  // Convenção: a PRIMEIRA action status_check declarada no manifest é a
  // que reflete o estado específico de cada worktree (ex. "Status dos
  // containers" do app/web) — usada só pro indicador do
  // seletor. Uma action de infra compartilhada daria o mesmo resultado
  // em qualquer worktree e não ajudaria a diferenciar.
  const primaryStatusAction = manifest?.actions.find((a) => a.status_check) ?? null;
  const worktreeActivity = useWorktreeActivity(worktrees, primaryStatusAction);

  const actionsByCategory = useMemo(() => {
    if (!manifest) return new Map<string, Action[]>();
    const grouped = new Map<string, Action[]>();
    for (const action of manifest.actions) {
      const list = grouped.get(action.category) ?? [];
      list.push(action);
      grouped.set(action.category, list);
    }
    return grouped;
  }, [manifest]);

  const statusActions = useMemo(
    () => manifest?.actions.filter((a) => a.status_check) ?? [],
    [manifest],
  );

  // Se tem um caminho salvo de uma sessão anterior, carrega sozinho ao
  // abrir — sem isso, o usuário teria que reabrir manualmente todo start.
  // Primeira execução (nada salvo ainda) continua exigindo o clique em
  // "Carregar", igual sempre foi.
  useEffect(() => {
    if (readLastManifestPath()) {
      loadManifest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadManifest(path: string = manifestPath) {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<Manifest>("load_manifest", { path });
      setManifest(result);
      setProjectRoot(await dirname(path));
      setEditingPath(false);
      writeLastManifestPath(path);
    } catch (err) {
      setManifest(null);
      setProjectRoot(null);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function pickManifestFile() {
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Selecione o dev-app.toml",
      filters: [{ name: "dev-app manifest", extensions: ["toml"] }],
    });
    if (typeof selected !== "string") return; // cancelado
    setManifestPath(selected);
    await loadManifest(selected);
  }

  function switchWorktree(worktree: WorktreeEntry) {
    // Só troca onde as ações rodam (cwd dos scripts) — o manifest em si
    // não é recarregado. Os scripts são os mesmos arquivos versionados
    // no repo em qualquer worktree, então não precisa (e não deveria
    // precisar) de um dev-app.toml duplicado em cada uma; só o
    // workspace onde o devctl abriu o manifest originalmente precisa
    // ter o arquivo.
    setProjectRoot(worktree.path);
  }

  function handleRunRequest(action: Action, toggleMode?: ToggleMode) {
    // Pede confirmação/params num diálogo quando a action tem params a
    // preencher OU é destrutiva (confirm=true); senão dispara direto.
    if (action.params.length > 0 || action.confirm) {
      setPending({ action, toggleMode });
      return;
    }
    if (action.mode === "interactive") {
      setInteractiveSession({ action, paramValues: {} });
      return;
    }
    executeAction(action, toggleMode, {});
  }

  async function executeAction(
    action: Action,
    toggleMode: ToggleMode | undefined,
    paramValues: Record<string, string>,
  ) {
    if (!projectRoot) {
      setError("Carregue um dev-app.toml antes de executar uma ação.");
      return;
    }
    try {
      await start(
        {
          project_root: projectRoot,
          action,
          param_values: paramValues,
          toggle_mode: toggleMode ?? null,
        },
        toggleMode ? `${action.label} — ${toggleMode}` : action.label,
      );
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border/60 bg-background/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">devctl</h1>
          {manifest && (
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {manifest.app.name}
            </Badge>
          )}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          {editingPath || !manifest ? (
            <form
              className="flex w-full items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                loadManifest();
              }}
            >
              <Input
                value={manifestPath}
                onChange={(e) => setManifestPath(e.currentTarget.value)}
                placeholder="Caminho do dev-app.toml"
                className="h-8 max-w-md"
              />
              <Button type="button" variant="outline" size="sm" onClick={pickManifestFile} disabled={loading}>
                Escolher…
              </Button>
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? "Carregando…" : "Carregar"}
              </Button>
              {manifest && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditingPath(false)}>
                  Cancelar
                </Button>
              )}
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditingPath(true)}
                title={manifestPath}
                className="flex min-w-0 items-center gap-1.5 rounded-lg border border-transparent px-2 py-1 text-xs text-muted-foreground hover:border-border hover:bg-muted"
              >
                <FolderOpen className="size-3.5 shrink-0" />
                <span className="truncate font-mono">{manifestPath}</span>
              </button>
              <WorktreeSelector
                worktrees={worktrees}
                currentPath={projectRoot}
                onSelect={switchWorktree}
                activity={worktreeActivity}
              />
            </>
          )}
        </div>

        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6">
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {manifest ? (
          <>
            <StatusPanel actions={statusActions} projectRoot={projectRoot} />

            <div className="flex flex-col gap-5">
              {[...actionsByCategory.entries()].map(([category, actions]) => (
                <section key={category} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      {category}
                    </h2>
                    <Badge variant="outline">{actions.length}</Badge>
                  </div>
                  <Separator />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {actions.map((action) => (
                      <QuickActionCard key={action.id} action={action} onRun={handleRunRequest} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        ) : (
          !error && (
            <Card className="mx-auto mt-12 max-w-md text-center">
              <CardHeader>
                <CardTitle>Nenhum projeto carregado</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Informe o caminho de um <code className="rounded bg-muted px-1 py-0.5">dev-app.toml</code> no
                topo da tela e clique em Carregar.
              </CardContent>
            </Card>
          )
        )}
      </main>

      <ActionRunTabs
        runs={runs}
        activeRunId={activeRunId}
        onSelect={setActiveRunId}
        onCancel={cancel}
        onClose={closeRun}
      />

      <RunActionDialog
        action={pending?.action ?? null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        onConfirm={(paramValues) => {
          if (!pending) return;
          if (pending.action.mode === "interactive") {
            setInteractiveSession({ action: pending.action, paramValues });
          } else {
            executeAction(pending.action, pending.toggleMode, paramValues);
          }
          setPending(null);
        }}
      />

      {interactiveSession && projectRoot && (
        <Suspense fallback={null}>
          <TerminalDialog
            action={interactiveSession.action}
            projectRoot={projectRoot}
            paramValues={interactiveSession.paramValues}
            onClose={() => setInteractiveSession(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
