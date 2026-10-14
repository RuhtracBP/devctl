# `dev-app.toml` — schema (rascunho)

Manifest que o projeto host versiona pra descrever suas ações
de dev pro app. O app em Rust só sabe ler isso + executar `script` como
subprocesso — nenhuma lógica de Docker/git/Laravel mora no app.

## `[app]`

| campo | tipo | obrigatório | descrição |
|---|---|---|---|
| `name` | string | sim | nome exibido no título da UI |
| `description` | string | não | subtítulo/contexto |
| `scripts_root` | string | não | só documentação — `script` de cada action já é path completo a partir da raiz do projeto |

## `[[actions]]`

| campo | tipo | obrigatório | descrição |
|---|---|---|---|
| `id` | string | sim | identificador estável, único. Não renomear entre versões (pode virar chave de atalho de teclado/histórico). |
| `label` | string | sim | texto exibido no menu |
| `category` | string | sim | agrupa ações em seções/abas na UI. Livre, mas convenção: `lifecycle`, `dependencies`, `app`, `worktree`, `infra`, `shortcuts` |
| `script` | string | sim | caminho relativo à raiz do projeto host |
| `mode` | enum | sim | ver abaixo |
| `params` | array de param | não | inputs coletados do usuário antes de rodar; viram argv posicionais, na ordem declarada |
| `confirm` | bool | não (default `false`) | se true, app pede confirmação (com `confirm_message`) antes de executar |
| `confirm_message` | string | requerido se `confirm=true` | texto da confirmação |
| `long_running` | bool | não (default `false`) | dica pra UI mostrar spinner/"isso pode demorar" em vez de assumir que travou |
| `status_check` | bool | não (default `false`) | dica pra UI: action somente-leitura (ex. `docker compose ps`) que pode virar um painel com refresh automático, além de continuar disponível como ação de menu normal |
| `toggle` | tabela | requerido se `mode="toggle"` | ver abaixo |
| `notes` | string | não | texto informativo mostrado na UI (efeitos colaterais, avisos) |

### `mode`

- **`instant`** — roda, mostra stdout/stderr em tempo real, termina sozinho. Caso mais comum (`migrate`, `seed`, `up`, `down`...).
- **`stream`** — processo contínuo que não termina sozinho (`docker compose logs -f`). UI precisa de uma tecla de cancelar (mata o processo, não só "sai da tela").
- **`interactive`** — precisa de um TTY real (`docker compose exec app sh`). O app cede o terminal por completo pro subprocesso (não dá pra desenhar UI por cima) e devolve o controle quando o shell fecha.
- **`toggle`** — script com sub-modos de background: rodar em foreground, iniciar em background, parar, checar status. Ver `[[actions]].toggle`.

### `[[actions]].toggle`

Quando `mode = "toggle"`, o script aceita um primeiro argv posicional que
seleciona o sub-modo. Ex.: `yarn-dev.sh` e `queue-work.sh` no
manifest de exemplo implementam isso (`run|start|stop|status`).

| campo | tipo | descrição |
|---|---|---|
| `run_arg` | string | argv passado pro modo foreground (mode "instant"/"stream" dentro do toggle) |
| `start_arg` | string | argv pro modo "inicia em background e volta o prompt" |
| `stop_arg` | string | argv pro modo "para o que está rodando em background" |
| `status_arg` | string | argv pro modo "mostra se está rodando" |

Na UI, uma action `toggle` vira 4 sub-itens (ou um único item com estado
visível: "● rodando" / "○ parado" + tecla pra iniciar/parar).

### `[[actions]].params[]`

| campo | tipo | obrigatório | descrição |
|---|---|---|---|
| `name` | string | sim | nome do param (só documentação/order) |
| `label` | string | sim | texto do prompt/campo de formulário |
| `type` | enum (`string`, `enum`) | sim | `string` = input livre; `enum` = lista fixa (`options`) |
| `options` | array de string | requerido se `type="enum"` | valores possíveis |
| `required` | bool | sim | se false e o usuário deixar vazio, o param é omitido do argv (não passa string vazia) |
| `default` | string | não | valor pré-preenchido no campo |
| `split_shell_words` | bool | não (default `false`) | se true, o valor é dividido em múltiplos argv por espaço em branco (`split_whitespace`, sem parsing de aspas) em vez de virar um único argv. Pra params tipo "argumentos livres de CLI" onde o script espera vários `$@` (ex. `php artisan "$@"` — "migrate --seed" precisa virar dois argv) |

## Regras de execução

1. `params` viram argv **posicionais**, na ordem declarada em `params[]`,
   depois de qualquer argv fixo que o `mode` já implique (ex: pro modo
   `toggle`, o `*_arg` correspondente vem primeiro, `params` depois).
   Exceção: um param com `split_shell_words = true` vira mais de um argv
   (divisão por espaço em branco, ver acima).
2. Nenhum param é interpolado em shell — o app monta um `Vec<String>` e
   roda `sh <script> <args...>` (`std::process::Command`), nunca
   `sh -c "..."` com os valores concatenados numa string. `split_whitespace`
   não é parsing de shell (não interpreta aspas/metacaracteres), só separa
   por espaço — continua sem risco de injeção.
3. O script roda via `sh`, não exec direto — não depende do bit de
   execução do arquivo (vários scripts reais não têm) e é o mesmo padrão
   que os `menu.sh` já assumem ao chamar `sh "$SCRIPT_DIR/$script_name"`.
4. `script` roda com `cwd` = raiz do projeto host (onde está o
   `dev-app.toml`), igual o padrão atual (`cd "$PROJECT_ROOT"` no topo de
   cada `.sh`).

## Coisas que este rascunho ainda não resolve

- Como o app descobre a raiz do projeto host (flag `--project <path>`?
  variável de ambiente? procura `dev-app.toml` subindo diretórios a partir
  do cwd, tipo `.git`?).
- Versionamento do schema em si (`schema_version` no `[app]`?) — pra o app
  não quebrar silenciosamente se o manifest evoluir num projeto e o
  binário instalado for antigo.
- `category` como enum livre funciona pro protótipo, mas pra várias
  centenas de actions (outros projetos) provavelmente quer virar
  hierarquia (`category.subcategory`) ou tags.
