# Roadmap — próximos passos

> Checklist resumido também em [`README.md`](../README.md#escopo-do-mvp)
> ("Escopo do MVP"); este arquivo detalha o *como* de cada passo pra
> quem (IA ou humano) for pegar a implementação.

## Feito

- [x] Parser + validação do `dev-app.toml` (`src-tauri/src/manifest.rs`),
      com teste contra o manifest de exemplo.
- [x] Comando Tauri `load_manifest` exposto pro frontend.
- [x] UI React lendo o manifest e listando as ações agrupadas por
      categoria, com badge de `mode` e de `confirm`.
- [x] `npm run tauri dev` validado — janela abre, manifest carrega.
- [x] Stack de UI: Tailwind CSS v4 + shadcn/ui (ver
      [`ui-stack.md`](ui-stack.md)).
- [x] Seletor de tema claro/escuro (`src/hooks/use-theme.ts` +
      `src/components/theme-toggle.tsx`).
- [x] devctl como app de menu bar no macOS (ícone de status). Inicialmente
      com `ActivationPolicy::Accessory` (sem ícone no Dock/Cmd+Tab), depois
      trocado pra `Regular` a pedido do usuário — presença nos dois
      lugares (menu bar e Dock/Cmd+Tab), não só na menu bar.
- [x] Runner de execução real (`src-tauri/src/runner.rs`): `instant` e
      `stream` rodam via `tokio::process::Command`, stdout/stderr em
      tempo real pro frontend via eventos `action://output` /
      `action://exit`, `toggle` dispara os 4 sub-modos
      (`run`/`start`/`stop`/`status`), `stream`/`toggle` em foreground
      são canceláveis (`cancel_action`, mata o processo). Frontend:
      `src/hooks/use-action-runner.ts` + painel de execução fixo no
      rodapé (depois virou `ActionRunTabs`, ver item de dashboard
      abaixo) + `RunActionDialog` (coleta `params` e mostra
      `confirm_message` antes de disparar — stopgap simples até o
      item 4 abaixo virar um modal melhor). `mode="interactive"`
      continua bloqueado (item 3).
- [x] Seletor de pasta nativo (`tauri-plugin-dialog`): botão "Escolher
      arquivo…" abre o diálogo nativo do macOS filtrado a `.toml`,
      carrega o manifest automaticamente ao selecionar. O `dirname()`
      ingênuo em JS também foi trocado pela API oficial
      (`@tauri-apps/api/path`) pra derivar o project root do runner.
- [x] Painel de status live: novo campo `status_check` no manifest
      (`src-tauri/src/manifest.rs` + `docs/manifest-schema.md`) marca
      uma action como consulta somente-leitura; o manifest de exemplo já
      tinha `status`/`infra-status` prontos pra isso, só faltava o
      campo — não precisou reimplementar `docker compose ps`, é a
      mesma action rerodada. Frontend: `use-status-poll.ts` reroda cada
      action `status_check=true` a cada 5s (evento
      `action://output`/`action://exit`, independente do runner
      principal) e `StatusPanel` mostra a última saída de cada uma,
      colorido por sucesso/erro.
- [x] Modo `interactive`: terminal embutido de verdade — decisão do
      usuário foi priorizar acesso ao output (abrir o Terminal.app
      perderia essa visibilidade) em vez da opção mais simples.
      Backend (`src-tauri/src/pty.rs`): `portable-pty` abre um PTY real,
      `start_interactive` roda o `script` dentro dele, uma thread lê o
      output e emite `pty://output` (bytes crus em base64, binário-safe
      pra sequências ANSI), `write_to_pty`/`resize_pty`/`close_pty`
      completam o ciclo. Frontend: `use-pty-session.ts` (encanamento
      IPC) + `TerminalDialog` (xterm.js, lazy-loaded — a lib é pesada e
      só entra no bundle se alguém abrir um terminal). `run_action`
      (`runner.rs`) continua rejeitando `interactive` — esse mode agora
      vai inteiro pelo caminho do PTY, não pelo runner de
      stdout/stderr simples.
      **Não validado rodando o app de verdade** (só build + testes
      unitários) — abrir uma action `interactive` real (`shell-app`,
      `infra-shell` no manifest de exemplo) é o próximo passo de QA antes de confiar
      cegamente nisso.
- [x] Dashboard/central de controle: header fixo com caminho do
      manifest + seletor de worktree (`worktrees.rs`, `git worktree
      list --porcelain`) + tema; ações viraram grade de "quick action
      cards" por categoria; status de containers vira chips coloridos
      por container (`src/lib/parse-table.ts`, parser heurístico de
      saída tabular, com fallback pro texto cru); execuções viraram
      abas (`ActionRunTabs` — várias `run_id` em paralelo, cada uma sua
      aba, ao invés de uma única run substituindo a anterior).
- [x] Persistir último projeto/manifest aberto: `src/lib/last-manifest.ts`
      salva o caminho no `localStorage` a cada `loadManifest` bem
      sucedido; ao abrir o app, se tiver algo salvo, carrega sozinho
      (primeira execução, sem nada salvo, continua exigindo o clique
      manual em "Carregar" — preserva o onboarding atual).

## Faltando

### 1. Modal de confirmação — polish

`RunActionDialog` (`src/components/run-action-dialog.tsx`) já cobre o
essencial: abre pra qualquer action com `confirm=true`, mostra
`confirm_message`, só dispara o runner após o usuário confirmar. O que
falta é polish, não a mecânica: destacar melhor ações destrutivas
(hoje é só o texto em vermelho + botão `variant="destructive"`), e
decidir se ações com `confirm=true` e zero `params` merecem um layout
dedicado em vez de reusar o formulário vazio.

## Fora de escopo (por decisão, não esquecimento)

Reimplementar parsing/lógica de Docker Compose ou git worktree dentro
do devctl — isso é território do projeto host, nos
scripts `.sh` que o manifest referencia. Ver princípio central no
[`README.md`](../README.md).
