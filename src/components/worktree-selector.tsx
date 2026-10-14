import { GitBranch } from "lucide-react";
import type { WorktreeEntry } from "@/hooks/use-worktrees";
import type { ActivityMap } from "@/hooks/use-worktree-activity";
import { cn } from "@/lib/utils";

interface WorktreeSelectorProps {
  worktrees: WorktreeEntry[];
  currentPath: string | null;
  onSelect: (worktree: WorktreeEntry) => void;
  /** Quais worktrees têm containers de pé — ver `use-worktree-activity.ts`. */
  activity?: ActivityMap;
}

/** Nome curto pra mostrar no seletor: a branch, ou o nome da pasta se detached. */
function worktreeLabel(w: WorktreeEntry): string {
  if (w.branch) return w.branch;
  const parts = w.path.replace(/\/+$/, "").split("/");
  return `${parts[parts.length - 1]} (detached)`;
}

/**
 * Seletor de worktree do projeto carregado — pensado pra caber numa
 * linha do header, ao lado do caminho do manifest. Só aparece quando o
 * projeto tem mais de um worktree (`git worktree list`). Trocar de
 * worktree só muda onde as actions rodam (`project_root`) — o manifest
 * em si NÃO é recarregado, continua sendo o mesmo já lido (os scripts
 * são os mesmos arquivos versionados em qualquer worktree do repo, não
 * precisa de um `dev-app.toml` duplicado em cada uma).
 *
 * `<option>` nativo não aceita HTML/CSS rico, então o indicador de
 * "containers de pé" dentro da lista é um emoji (🟢) — funciona em
 * qualquer plataforma sem precisar reescrever isto como um dropdown
 * customizado. O ponto colorido ao lado do ícone de branch reflete só a
 * worktree selecionada no momento (esse sim é um `<span>` com CSS).
 */
export function WorktreeSelector({ worktrees, currentPath, onSelect, activity = {} }: WorktreeSelectorProps) {
  if (worktrees.length <= 1) return null;

  const currentValue =
    worktrees.find((w) => w.path === currentPath)?.path ?? worktrees[0].path;
  const currentActive = activity[currentValue];

  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 px-2 py-1">
      <span className="relative flex shrink-0 items-center">
        <GitBranch className="size-3.5 text-muted-foreground" />
        {currentActive && (
          <span
            className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-emerald-500"
            title="Containers de pé nesta worktree"
          />
        )}
      </span>
      <select
        aria-label="Worktree"
        className={cn("h-6 max-w-40 truncate border-0 bg-transparent text-xs focus-visible:outline-none")}
        value={currentValue}
        onChange={(e) => {
          const worktree = worktrees.find((w) => w.path === e.currentTarget.value);
          if (worktree) onSelect(worktree);
        }}
      >
        {worktrees.map((w) => (
          <option key={w.path} value={w.path}>
            {activity[w.path] ? "🟢 " : ""}
            {worktreeLabel(w)}
            {w.locked ? " 🔒" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
