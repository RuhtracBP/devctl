# Stack de UI: Tailwind CSS v4 + shadcn/ui

> Instrução para futuras execuções de IA/humanos neste projeto. Se você
> for adicionar UI nova, siga isso — não introduza outra lib de
> componentes (Material UI, Chakra, Ant Design, styled-components etc.)
> nem volte a escrever CSS puro em arquivos `*.css` avulsos por
> componente.

## Decisão

O frontend (`src/`) usa **Tailwind CSS v4** + **shadcn/ui** (base
Radix UI) como stack de UI oficial do devctl. Aplicado em 2026-09-04.

- Tailwind v4 via plugin do Vite (`@tailwindcss/vite`), sem
  `tailwind.config.js`/`postcss.config.js` — v4 é config-less, tudo
  fica em `@theme`/CSS variables dentro de `src/index.css`.
- shadcn/ui **não é uma dependência de pacote com componentes prontos
  a importar de um bundle** — é um gerador: `npx shadcn add <componente>`
  copia o código-fonte do componente pra `src/components/ui/`. Isso
  significa que os componentes já adicionados **são código do próprio
  repo** e podem/devem ser editados livremente aqui.
- Estilo: preset `radix-nova` (base color `neutral`, ícones
  `lucide-react`), ver `components.json`.

## Onde as coisas ficam

- `src/index.css` — import do Tailwind + tokens de tema (CSS vars
  `--background`, `--foreground`, `--primary` etc.) em light/dark via
  classe `.dark`. **Fonte única de verdade de tema** — não recriar
  tokens de cor em outro arquivo.
- `src/components/ui/` — componentes gerados pelo shadcn (button,
  card, dialog, badge, input, label, separator, scroll-area, ...).
  Editáveis à vontade, são nossos.
- `src/lib/utils.ts` — helper `cn()` (merge de classes Tailwind), usar
  em vez de concatenar strings de className manualmente.
- `components.json` — config do CLI do shadcn (estilo, aliases,
  base color). Não apagar; é o que faz `npx shadcn add ...` funcionar
  de novo.
- Alias de import `@/*` → `src/*`, configurado em `tsconfig.json`
  (`compilerOptions.paths`) e `vite.config.ts` (`resolve.alias`). Os
  dois têm que ficar sincronizados — se mexer num, mexe no outro.

## Como adicionar um componente novo

```bash
npx shadcn@latest add <nome-do-componente>
# ex.: npx shadcn@latest add select tabs toast
```

Isso baixa o código-fonte do componente pra `src/components/ui/` com
as dependências certas no `package.json`. Depois é só importar de
`@/components/ui/<nome>`.

Catálogo de componentes disponíveis: https://ui.shadcn.com/docs/components

## Convenções pro resto da app

- Novo componente de UI = função React em `src/components/` (fora de
  `ui/`, que é território do shadcn) usando classes Tailwind +
  primitivas de `src/components/ui/`. Evitar `*.css` novo por
  componente — `App.tsx` já foi migrado (era o único ponto com CSS
  avulso, `App.css`, removido).
- Tema dark/light continua automático via `prefers-color-scheme` +
  tokens do shadcn (`--background`, `--foreground` etc.), não
  hardcodar cores hex fora de `src/index.css`.
- `cn(...)` de `@/lib/utils` para composição condicional de classes.

## Por que essa escolha (contexto p/ IA)

- devctl é Tauri (webview local) + React — Tailwind é a via mais
  padrão pro ecossistema Vite/React e shadcn é o gerador de
  componentes mais usado sobre Tailwind hoje, com bom suporte a
  temas, acessibilidade via Radix, e zero dependência de runtime de
  UI library pesada (o código vem pro repo, não é um pacote npm de
  componentes).
- Decisão do autor, tomada explicitamente em 2026-09-04,
  sem ambiguidade a resolver — não reabrir essa escolha sem motivo
  novo.
