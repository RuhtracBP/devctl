# devctl

> Status: protótipo inicial. Nada aqui é estável ainda.

Um app desktop (Tauri: backend Rust + UI React) que dá uma interface
real e amigável, com refresh ao vivo, pro ambiente de dev de um projeto
— sem reimplementar a lógica de Docker Compose / git worktree que o
projeto já tem em scripts shell.

## Motivação

Times que usam Docker Compose + múltiplos ambientes (ex.: git worktrees
compartilhando infra) normalmente acabam com um `menu.sh` ou similar:
um menu numerado em shell que despacha pra scripts atômicos. Funciona,
mas:

- Status de containers é uma foto estática — precisa rerodar manualmente
  pra ver o que mudou.
- Sem visão agregada quando há múltiplos ambientes rodando contra uma
  infra compartilhada.
- Menu numerado não escala — sem busca, sem atalhos, precisa decorar
  opções.

`devctl` resolve isso **sem virar dono da lógica de infra**: ele lê um
manifest (`dev-app.toml`) que o projeto host já versiona, descrevendo as
ações existentes (script, categoria, modo de execução), e cuida só de:
apresentação, agregação de estado, refresh automático, navegação.

## Princípio central: casca, não reimplementação

`devctl` nunca fala com Docker/git diretamente. Ele **invoca os scripts
`.sh` do projeto host como subprocessos**. Isso significa:

- Os scripts continuam sendo a fonte de verdade, versionados e revisados
  no repo do projeto, sem exigir Rust pra mexer na lógica de infra.
- `devctl` é uma camada fina, substituível, que qualquer projeto que siga
  a convenção do manifest pode adotar.

## O manifest (`dev-app.toml`)

Ver [`docs/manifest-schema.md`](docs/manifest-schema.md) pro schema
completo, e [`examples/laravel-app.dev-app.toml`](examples/laravel-app.dev-app.toml)
pra um exemplo de projeto Laravel + Docker Compose + git worktrees com
infra compartilhada.

Cada ação declara:

- `script` — caminho do `.sh` a rodar, relativo à raiz do projeto host.
- `mode` — como apresentar o processo: `instant` (roda e termina),
  `stream` (contínuo, tipo `logs -f`, cancelável), `interactive`
  (precisa de TTY real, ex. shell), `toggle` (scripts com sub-modos
  `run`/`start`/`stop`/`status` em background).
- `params` — inputs que o usuário preenche antes de rodar, viram argv
  posicionais (nunca interpolados em shell — sempre `Vec<String>` direto
  pro `Command`, sem risco de injeção).
- `confirm` / `confirm_message` — pra ações destrutivas ou que afetam
  outros ambientes além do atual.

## Escopo do MVP

> Detalhamento de cada item pendente (o *como*) em
> [`docs/roadmap.md`](docs/roadmap.md).

- [x] Parser + validação do `dev-app.toml` (`src-tauri/src/manifest.rs`,
      com teste rodando contra o manifest de exemplo).
- [x] Comando Tauri `load_manifest` exposto pro frontend.
- [x] UI React lendo o manifest e listando as ações agrupadas por
      categoria, com badge de `mode` e de `confirm`.
- [x] Execução `instant`/`stream`: `tokio::process::Command`,
      stdout/stderr em tempo real (eventos Tauri), exit code ao final,
      cancelável.
- [x] Execução `toggle`: 4 sub-ações (`run`/`start`/`stop`/`status`).
- [x] Confirmação (modal) antes de ações `confirm = true`, com coleta
      de `params` no mesmo diálogo.
- [x] Seletor de pasta nativo (`tauri-plugin-dialog`) pra escolher o
      `dev-app.toml`.
- [x] Painel de status com refresh automático (reroda as actions
      `status_check = true` do manifest a cada 5s, colorido por
      sucesso/erro).
- [x] Execução `interactive`: terminal embutido (`xterm.js` + PTY real
      no backend via `portable-pty`) — devctl mantém acesso total ao
      output, diferente de abrir o Terminal.app.
- [x] Seletor de git worktree do projeto carregado (`git worktree list`,
      só leitura) — trocar de worktree só muda onde as ações rodam
      (`project_root`), o manifest carregado não é relido; não precisa
      de um `dev-app.toml` duplicado em cada worktree. Indicador
      (🟢) de quais worktrees têm containers de pé, rerodando a
      primeira action `status_check` do manifest com o `project_root`
      de cada uma (`use-worktree-activity.ts`).
- [x] Persistir o último projeto aberto (localStorage, carrega sozinho
      ao abrir o app).

Fora de escopo por enquanto: reimplementar parsing de
`docker-compose.yml` (sempre delega pro `docker compose` CLI real),
gerenciar segredos/`.env`, mobile (o template Tauri suporta Android/iOS,
mas não é o alvo aqui).

## Stack

- **Backend** (`src-tauri/`, Rust): `tauri` 2, `serde` + `toml` (parse do
  manifest), `anyhow`. Execução de subprocessos vai usar
  `tokio::process::Command` direto (sem `sh -c`), pra não abrir shell
  injection via input do usuário.
- **Frontend** (`src/`, React + TypeScript + Vite): consome os comandos
  Tauri via `@tauri-apps/api`. `src/types.ts` espelha manualmente os
  tipos de `src-tauri/src/manifest.rs` — considerar gerar isso
  automaticamente (`specta`/`ts-rs`) quando o schema estabilizar.
  UI construída com **Tailwind CSS v4 + shadcn/ui** — ver
  [`docs/ui-stack.md`](docs/ui-stack.md) antes de adicionar componentes
  ou telas novas (é a stack de UI oficial do projeto, não introduzir
  outra).

## Desenvolvimento

```sh
npm install
npm run tauri dev    # abre o app com hot-reload (frontend + backend)

# só o backend Rust (parser, testes):
cd src-tauri && cargo test

# build de produção (gera binário instalável):
npm run tauri build
```

Ao abrir o app, cole o caminho de um `dev-app.toml` (o exemplo em
`examples/laravel-app.dev-app.toml` funciona de cara a partir de
`src-tauri/`, que é o cwd em dev) e clique em Carregar. Todos os `mode`
já executam de verdade, incluindo `interactive` (terminal embutido via
PTY).

## Estrutura

```
devctl/
├── src/                  # frontend React + TS
│   ├── App.tsx           # painel de ações (lê o manifest, agrupa por categoria, dispara execução)
│   ├── types.ts          # espelho manual dos tipos do backend
│   ├── index.css         # Tailwind + tokens de tema (shadcn)
│   ├── components/
│   │   ├── ui/                    # componentes shadcn/ui (código gerado, editável)
│   │   ├── action-run-tabs.tsx    # console fixo, uma aba por execução (paralelas)
│   │   ├── run-action-dialog.tsx  # coleta params / confirma ações destrutivas antes de rodar
│   │   ├── status-panel.tsx       # status_check com refresh automático
│   │   ├── terminal-dialog.tsx    # terminal embutido (xterm.js) pra mode="interactive", lazy-loaded
│   │   ├── worktree-selector.tsx  # dropdown de git worktree do projeto carregado
│   │   └── theme-toggle.tsx
│   ├── hooks/
│   │   ├── use-action-runner.ts  # dispara/acompanha execução (invoke + eventos Tauri)
│   │   ├── use-status-poll.ts    # reroda actions status_check periodicamente
│   │   ├── use-pty-session.ts    # encanamento IPC do terminal embutido
│   │   ├── use-worktrees.ts      # lista git worktrees do projeto carregado
│   │   ├── use-worktree-activity.ts  # quais worktrees têm containers de pé
│   │   └── use-theme.ts
│   └── lib/
│       ├── utils.ts            # helper cn() do shadcn
│       ├── parse-table.ts      # parser heurístico de saída tabular (status)
│       └── last-manifest.ts    # localStorage do último dev-app.toml aberto
├── components.json        # config do CLI do shadcn (estilo, aliases)
├── src-tauri/             # backend Rust (Tauri)
│   └── src/
│       ├── manifest.rs   # parser + validação do dev-app.toml
│       ├── runner.rs     # execução das actions instant/stream/toggle (tokio::process::Command)
│       ├── pty.rs        # terminal embutido pra mode="interactive" (portable-pty)
│       ├── worktrees.rs  # lista git worktrees do projeto (git worktree list, só leitura)
│       ├── commands.rs   # comandos expostos pro frontend (invoke)
│       └── lib.rs        # registro dos comandos, tray da menu bar, bootstrap do Tauri
├── examples/
│   └── laravel-app.dev-app.toml  # manifest de exemplo (Laravel + Docker Compose)
└── docs/
    ├── manifest-schema.md   # schema documentado do dev-app.toml
    ├── ui-stack.md           # stack de UI (Tailwind + shadcn) e convenções
    └── roadmap.md            # próximos passos, com o "como" de cada um
```
