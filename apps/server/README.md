# @neurons/server

Servidor do NeuronsAI: NestJS 12 com adaptador Fastify, Drizzle ORM sobre um banco embutido (PGlite) ou Postgres, e um gateway WebSocket para eventos de execução. Escuta **somente em endereços locais** (`127.0.0.1` por padrão) porque ainda não há login.

O Hub de mensagens (T06), os runtimes de terminal do Claude Code (T08, pacote `@neurons/agent-runtimes`), as guardas e a API REST (T10) e o protocolo de runner (T24, os agentes rodam num runner embutido ou separado) estão prontos; o runtime de API chega na T07.

## Variáveis de ambiente

Copie `.env.example` para `.env` (ignorado pelo git) e preencha. Valores vazios contam como "não definido". Qualquer valor inválido derruba o processo na partida, com uma mensagem listando todos os problemas.

| Variável                           | Padrão      | Descrição                                                                                                                                                                          |
| ---------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEURONS_MODE`                     | `all`       | `api`, `worker` ou `all`. Por ora só decide quais módulos sobem (ver abaixo).                                                                                                      |
| `NEURONS_HOST`                     | `127.0.0.1` | Onde escutar. Qualquer endereço que não seja local (`127.x`, `::1`, `localhost`) exige também `NEURONS_ALLOW_REMOTE=true`: sem login, quem alcança a porta usa a API.              |
| `NEURONS_ALLOW_REMOTE`             | `false`     | Confirma que o servidor pode escutar fora desta máquina.                                                                                                                           |
| `NEURONS_PORT`                     | `3100`      | Porta do servidor.                                                                                                                                                                 |
| `NEURONS_RUN_MAX_MESSAGES`         | `200`       | Mensagens (de qualquer tipo) que uma execução troca antes de ser parada pela guarda.                                                                                               |
| `NEURONS_PING_PONG_MESSAGES`       | `20`        | Mensagens seguidas entre os mesmos dois agentes, sem ninguém mais, até a guarda de pingue-pongue parar a execução (mínimo 2).                                                      |
| `NEURONS_RUN_BUDGET_USD`           | —           | Orçamento em US$ de uma execução que não define o seu. Vazio: sem limite.                                                                                                          |
| `NEURONS_USAGE_FLUSH_MS`           | `4000`      | Ao parar, quanto tempo esperar o turno que estava em andamento terminar e informar o uso (o custo da última resposta chega depois do `finish`).                                    |
| `NEURONS_TERMINAL_INPUT_MAX_CHARS` | `4096`      | Caracteres que uma mensagem `terminal.input` do `/ws` pode ter (uma colagem chega numa mensagem só). Acima disso: `input_too_large`.                                               |
| `NEURONS_TERMINAL_INPUT_PER_SEC`   | `100`       | Mensagens `terminal.input` por segundo que uma conexão pode mandar (cabe uma rajada desse tamanho). Acima disso: `rate_limited`.                                                   |
| `NEURONS_ASK_TIMEOUT_SEC`          | `120`       | Segundos que um `ask` espera pela resposta antes de falhar.                                                                                                                        |
| `NEURONS_PROFILE`                  | `local`     | Onde os agentes rodam: `local` (runner embutido neste processo), `hybrid` (runners que se conectam a `/runner`) ou `hosted` (igual ao `hybrid` até a T26). Ver "Runners e perfis". |
| `NEURONS_RUNNER_GRACE_SEC`         | `60`        | Quanto tempo um runner que perdeu a conexão pode levar para voltar antes de seus agentes falharem.                                                                                 |
| `NEURONS_RUNNER_HEARTBEAT_SEC`     | `15`        | Intervalo do sinal de vida entre servidor e runner (3 perdidos fecham a conexão) e da checagem de token revogado.                                                                  |
| `NEURONS_RUNNER_WAIT_SEC`          | `30`        | Quanto tempo iniciar um agente espera por um runner conectado antes de falhar.                                                                                                     |
| `NEURONS_CLAUDE_BIN`               | —           | Caminho do executável do Claude Code usado pelos agentes de terminal. Vazio: procura sozinho (PATH, pastas dos instaladores e, no Windows, a CLI embutida no app desktop).         |
| `NEURONS_DB`                       | `embedded`  | `embedded` (PGlite, dentro do processo) ou `postgres`. As variáveis `NEURONS_DB_*` abaixo só valem com `postgres`.                                                                 |
| `NEURONS_DATA_DIR`                 | por sistema | Pasta de dados do app (ver abaixo). O banco embutido fica em `<pasta>/db`.                                                                                                         |
| `NEURONS_DB_URL`                   | —           | URL completa do Postgres. Tem prioridade sobre as variáveis abaixo.                                                                                                                |
| `NEURONS_DB_HOST`                  | —           | Host do banco.                                                                                                                                                                     |
| `NEURONS_DB_PORT`                  | `5432`      | Porta do banco.                                                                                                                                                                    |
| `NEURONS_DB_USER`                  | —           | Usuário do banco.                                                                                                                                                                  |
| `NEURONS_DB_NAME`                  | —           | Nome do database.                                                                                                                                                                  |
| `NEURONS_DB_PASSWORD`              | —           | Senha do banco.                                                                                                                                                                    |
| `NEURONS_MASTER_KEY`               | —           | Chave AES-256 (32 bytes em base64) que cifra os segredos. Sem ela, só os segredos falham.                                                                                          |

Por padrão (`NEURONS_DB=embedded`) o servidor sobe **sem Postgres nenhum**: o banco é o PGlite e as migrations são aplicadas na partida. Com `NEURONS_DB=postgres` e nenhuma variável `NEURONS_DB_*` o servidor também sobe, e `GET /health` informa `database.status = "not_configured"`. O mesmo vale para a chave mestra.

Pasta de dados padrão (quando `NEURONS_DATA_DIR` está vazio):

| Sistema | Pasta                                                    |
| ------- | -------------------------------------------------------- |
| Windows | `%APPDATA%\NeuronsAI`                                    |
| macOS   | `~/Library/Application Support/NeuronsAI`                |
| Linux   | `$XDG_DATA_HOME/neuronsai` ou `~/.local/share/neuronsai` |

**Uma pasta, um processo.** O banco embutido pega uma trava por arquivo (`<pasta>/db.lock`, com o PID) ao abrir: um segundo processo (outro servidor, o app desktop, o `runner:token`) recebe `DataDirLockedError`, com o PID e o caminho, em vez de corromper o banco. Uma trava deixada por um processo que já morreu é retomada sozinha. Para embutir o servidor em outro programa (o app desktop), use `@neurons/server` (`createApp`, `loadConfig`); `createApp(config, { ui: { root } })` também serve a interface compilada em `/`, com a API em `/api` e uma CSP restritiva.

Senhas de banco nunca saem em logs nem em erros: a URL aparece com a senha trocada por `***`. Para gerar uma chave:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

### Modos

| Modo     | Módulos                                                      |
| -------- | ------------------------------------------------------------ |
| `api`    | comuns + `graphs`, `realtime`, `GET /openapi.json`           |
| `worker` | comuns + `runs` (Hub, guardas, ciclo e endpoints de `/runs`) |
| `all`    | tudo                                                         |

Módulos comuns: `database`, `secrets`, `health`. Em qualquer modo o processo escuta HTTP em `NEURONS_HOST` (local por padrão).

## Runners e perfis

Os agentes de terminal (Claude Code) não rodam no Hub: rodam num **runner**, que o servidor comanda pelo protocolo de [`@neurons/runner-protocol`](../../packages/runner-protocol/README.md) (decisão D14: onde o agente roda é configuração, não código). O Hub, o Supervisor e as guardas falam com um `RemoteAgentRuntime`, que implementa a mesma `AgentRuntime` de sempre.

| Perfil (`NEURONS_PROFILE`) | Quem hospeda os agentes                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local` (padrão)           | Um runner **embutido** neste processo, ligado por um canal em memória que usa o mesmo protocolo. Não aceita runners de fora (`/runner` responde `not_accepted`). |
| `hybrid`                   | Runners **separados** que abrem uma conexão de saída para `ws://<servidor>/runner`, cada um com seu token. Nada roda no servidor.                                |
| `hosted`                   | Igual ao `hybrid` por enquanto; muda quando os runners passarem a ser operados na nuvem (T26).                                                                   |

**Token por runner.** O servidor emite, o runner apresenta, o servidor confere. Só o SHA-256 fica no banco (tabela `runners`):

```bash
pnpm --filter @neurons/server runner:token create meu-notebook   # mostra o token uma única vez
pnpm --filter @neurons/server runner:token list                  # nome, ativo/revogado, última conexão
pnpm --filter @neurons/server runner:token revoke meu-notebook   # recusa o runner e derruba o conectado
```

O token vai no cabeçalho `Authorization: Bearer` do upgrade do WebSocket (nunca no endereço) e não aparece em log, evento nem frame; o runner é configurado como em [`@neurons/runner`](../../packages/runner/README.md). Com o banco embutido, o comando precisa que o servidor não esteja rodando (só um processo por pasta de dados): num servidor de verdade use Postgres. O servidor continua escutando só em `127.0.0.1`; para um runner de outra máquina alcançá-lo é preciso `NEURONS_HOST` + `NEURONS_ALLOW_REMOTE=true` (ou um proxy com TLS na frente).

**Escolha do runner.** Um agente novo vai ao runner conectado com menos agentes; se não há nenhum, espera até `NEURONS_RUNNER_WAIT_SEC` e falha com `no_runner_available`.

**Conexão que cai.** Os agentes do runner continuam rodando. O servidor espera `NEURONS_RUNNER_GRACE_SEC` pelo runner: ao voltar, ele manda o estado dos agentes que ainda tem, o servidor reenvia o que ele não respondeu (iniciar, entregar, parar) e o runner reenvia as chamadas ao Hub sem resposta. Cada reenvio é idempotente (por id), então nenhuma mensagem se perde nem chega duas vezes. Se o prazo passa, ou se o runner volta sem o agente (reiniciou), o agente vira `AgentFailed` no log com o motivo, como qualquer outra falha. A saída do terminal é efêmera: o que passou durante a queda não é reenviado.

**Revogação.** Revogar um token recusa novas conexões e derruba a ativa na próxima checagem (a cada `NEURONS_RUNNER_HEARTBEAT_SEC`). Um runner recusado (`unauthorized`, `unsupported_protocol`, `not_accepted`) não tenta de novo.

## Criar o banco (uma vez)

Só para o modo `NEURONS_DB=postgres` (o banco embutido não precisa de nada disso). Requer o Postgres 18 local. O script `db/setup-local.sql` cria o usuário `neurons` e o database `neurons_dev`. Ele é idempotente (pode rodar de novo; a senha do usuário é redefinida) e recebe a senha por parâmetro, sem gravá-la em arquivo. Rode como superusuário `postgres` (o `psql` pede a senha dele):

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -v neurons_password="ESCOLHA_UMA_SENHA" -f apps/server/db/setup-local.sql
```

Depois configure o `.env` do servidor:

```dotenv
NEURONS_DB=postgres
NEURONS_DB_HOST=127.0.0.1
NEURONS_DB_USER=neurons
NEURONS_DB_NAME=neurons_dev
NEURONS_DB_PASSWORD=ESCOLHA_UMA_SENHA
NEURONS_MASTER_KEY=<chave gerada acima>
```

E aplique as migrations:

```bash
pnpm --filter @neurons/server db:migrate
```

## Rodar

```bash
pnpm --filter @neurons/server dev      # desenvolvimento, recarrega ao salvar
pnpm --filter @neurons/server build    # compila para dist/
pnpm --filter @neurons/server start    # roda o build
```

Verificação rápida: `http://127.0.0.1:3100/health`. O campo `database.type` diz qual banco está em uso (`embedded` ou `postgres`) e `database.status` o estado (`up`, `down` ou `not_configured`). Retorna 200 com `status: "ok"` (inclusive sem banco configurado) ou 503 com `status: "degraded"` quando o banco está configurado mas não responde. Erros HTTP têm sempre o formato `{ "code": "...", "message": "...", "details"?: [...] }` (ver "API REST").

## API REST

Sem login ainda. Cada endpoint declara o seu contrato em zod (`*.contract.ts`: parâmetros, query, corpo e resposta) e o `@Endpoint(contrato)` do controller usa **esse mesmo** schema para validar o pedido, conferir a resposta e gerar o OpenAPI: não há DTO escrito à mão. Um pedido fora do contrato recebe `400`; um campo que o schema de resposta não nomeia nunca sai do servidor.

| Método e caminho                                    | O que faz                                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/POST /graphs`, `GET/PATCH/DELETE /graphs/{id}` | CRUD de grafos (nome e rascunho). Só apaga grafo sem versões publicadas (`409 graph_has_versions`).                                                                                         |
| `GET /graphs/{id}/versions`, `GET .../{version}`    | Versões publicadas (imutáveis).                                                                                                                                                             |
| `POST /graphs/{id}/versions`                        | Valida com o `validateGraph` e congela a próxima versão. Sem `definition`, publica o rascunho. Inválido: `400 invalid_graph` com `details` apontando o que corrigir.                        |
| `POST /runs`, `GET /runs`, `GET /runs/{id}`         | Inicia uma execução de uma versão (`graphVersionId`, `input`, `triggerId?`, `budgetUsd?`), [lista com filtros](#get-runs-lista-de-execuções) e detalha (motivo do fim, consumo por agente). |
| `POST /runs/{id}/stop`                              | Para a execução: encerra os runtimes e os terminais (`RunService` → `Supervisor.stopRun`). Pode repetir.                                                                                    |
| `POST /runs/{id}/messages`                          | Manda uma mensagem como `@human` a qualquer agente da execução (as setas não valem para você).                                                                                              |
| `GET /runs/{id}/messages`, `GET /runs/{id}/events`  | Mensagens e eventos em ordem (`afterSeq`/`fromSeq`, `limit`): o mesmo log que o WebSocket transmite.                                                                                        |
| `GET /secrets`, `PUT /secrets/{name}`               | **Só** nomes e escrita. O valor entra e nunca volta: nenhum schema de resposta o carrega, e erros de validação não repetem o que foi enviado.                                               |
| `GET /openapi.json`, `GET /health`                  | Documento OpenAPI e saúde.                                                                                                                                                                  |

### `GET /runs`: lista de execuções

Todos os parâmetros são opcionais e se combinam com **E**:

| Parâmetro                    | O que faz                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                     | `pending`, `running`, `succeeded`, `failed` ou `cancelled`.                                                                                              |
| `graphId` / `graphVersionId` | Só as execuções desse grafo / dessa versão publicada (o id da versão, de `GET /graphs/{id}/versions`).                                                   |
| `minCostUsd` / `maxCostUsd`  | Faixa do **custo conhecido**, inclusive nos dois lados (`min <= max`, senão `400`).                                                                      |
| `from` / `to`                | Faixa do **início** (`startedAt`), inclusive, em ISO 8601 UTC (`2026-11-02T00:00:00Z`). Quem nunca começou (`pending`) não entra quando um dos dois vem. |
| `sort` / `order`             | `startedAt` (padrão) ou `costUsd`; `desc` (padrão: mais recentes ou mais caras primeiro) ou `asc`. Desempate por início e `id`, então a ordem é estável. |
| `limit` / `offset`           | Página de 50 por padrão (1 a 200) e quantas execuções pular.                                                                                             |

A resposta é `{ items, total, limit, offset }`; `total` conta tudo o que casa com os filtros, ignorando a página. Cada item traz o necessário para uma tabela: `graphId`, `graphName`, `graphVersionId`, `graphVersion` (o número), `status`, `startedAt`, `finishedAt`, `durationMs` (nulo enquanto não terminou), `costUsd`, `turns` e `unknownCostTurns`.

- **Paginação por `offset`**, não por cursor: a tela precisa de "página 3 de 8" e de pular para uma página, e o `total` vem de graça. O custo é que, se entrar uma execução enquanto se navega, as páginas se deslocam; como a ordem padrão é por início decrescente, isso só empurra itens para a página seguinte. Com milhares de execuções um cursor (`startedAt`, `id`) seria mais barato, mas a lista local não chega lá.
- **Custo desconhecido nunca vira 0 e o filtro de custo vale para a parte conhecida.** `costUsd` é a soma dos turnos que informaram preço e `unknownCostTurns` conta os que não informaram (como em `GET /runs/{id}`). `minCostUsd`/`maxCostUsd` comparam esse `costUsd`: uma execução com `costUsd` 0,50 e 2 turnos sem preço entra em `minCostUsd=0.4` e em `maxCostUsd=1`, embora o gasto real possa ser maior; uma sem nenhum turno conhecido tem `costUsd` 0 e entra em `maxCostUsd=0`, mas o item mostra `unknownCostTurns > 0` para a tela avisar ("≥ US$ 0,50 + 2 turnos sem custo", "Desconhecido"). Execuções sem nenhum turno de uso têm `turns: 0`. Quem precisa só das totalmente conhecidas filtra no cliente por `unknownCostTurns === 0`.
- **Sem N+1:** o custo vem de uma única agregação (`sum ... filter`, `count`) sobre os eventos `UsageRecorded`, unida às execuções; o total é uma segunda consulta com os mesmos filtros. A coluna `runs.spent_usd` continua sem uso: o log é a fonte.
- **Índices** (migration `0004_run_listing_indexes`): `runs(graph_version_id)`, `runs(started_at desc, id desc)` e, parcial, `run_events(run_id) where type = 'UsageRecorded'`, que alimenta a agregação.

**Erros**: sempre `{ code, message, details? }`. `code` é estável e em inglês (o cliente decide por ele), `message` é pt-BR e `details` lista `{ path, code, message }` de cada campo errado (`body.name`, `params.id`...). Um corpo que não é JSON recebe `400 bad_request` sem citar o corpo. Códigos comuns: `graph_not_found`, `run_not_found` (404), `run_not_active` (409), `unknown_recipient` (400), `master_key_not_configured` (503).

## Guardas

Parar uma execução (ou um agente) por exceder um limite nunca é silencioso: o `GuardEnforcer` grava o evento **`GuardTripped`** (`guard`, `scope`, `reason` em pt-BR e os números) _antes_ de parar. Uma guarda de escopo `run` termina a execução com `RunFinished { reason: "guard_tripped", guard, message }` e status `failed`; uma de escopo `agent` marca o agente como `AgentFailed` com o motivo, para o runtime dele e a execução segue sem ele. As guardas de mensagem também recusam a mensagem (o remetente recebe o erro).

| Guarda (`guard`)    | Onde                              | Regra e padrão                                                                                                                                                                                                                                               |
| ------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `run_max_messages`  | política na cadeia do Hub         | Mensagens da execução (todos os tipos, `@human` e `@trigger` incluídos) >= `NEURONS_RUN_MAX_MESSAGES` (**200**).                                                                                                                                             |
| `link_max_messages` | política na cadeia do Hub         | `maxMessages` da seta: mensagens que iniciam conversa (`message` e `ask`) entre os dois agentes, nos dois sentidos somados. Respostas (`reply`) não contam nem são recusadas: fecham uma pergunta que o limite já deixou passar.                             |
| `ping_pong`         | política na cadeia do Hub         | **20** mensagens seguidas (`NEURONS_PING_PONG_MESSAGES`) entre os mesmos dois agentes, nos dois sentidos, sem terceiro agente, `@human` ou `@trigger` no meio. A mensagem que completaria o trecho é recusada. Quem chama `finish` encerra a execução antes. |
| `run_budget`        | `BudgetGuard`, ao registrar o uso | Soma do custo conhecido de todos os agentes >= `budgetUsd` da execução (`POST /runs`) ou `NEURONS_RUN_BUDGET_USD`.                                                                                                                                           |
| `agent_budget`      | `BudgetGuard`, ao registrar o uso | Custo conhecido do agente >= `budgetUsd` do bloco: **só esse agente** é parado.                                                                                                                                                                              |
| `idle_timeout`      | `IdleWatchdog`                    | Agente `busy` por `idleTimeoutSec` sem sinal de vida (mensagem, `ask`, `reply`, `list_peers`, uso ou `finish` recomeçam a contagem). Em `waiting_reply` o relógio para (o `ask` tem timeout próprio). Para só o agente.                                      |

**O `total_cost_usd` do stream-json é acumulado na sessão** (medido com o Claude Code real na T24), então o runtime reporta a diferença entre um `result` e o anterior: o `UsageRecorded` de cada turno traz o custo daquele turno, e a soma dos turnos é o total, o mesmo número que o `--max-budget-usd` do CLI compara.

**Custo desconhecido nunca vira zero.** O evento `UsageRecorded` grava `costUsd: null` quando o runtime não informou o preço; esses turnos ficam à parte (`unknownCostTurns`, visível em `GET /runs/{id}`, onde `costUsd` passa a ser um limite inferior). Quando há um orçamento que isso impede de respeitar, um `GuardWarning` avisa uma vez por agente: `runtime_without_cost` (o runtime nunca informa custo: o terminal em modo PTY, `AgentRuntime.reportsCost = false`) ou `cost_unknown` (um turno veio sem custo). O orçamento só vale para o custo que o runtime informa; o stream-json informa, e o CLI recebe também `--max-budget-usd`.

**O último uso não se perde.** O `finish` chega no meio de um turno e o `result` do stream-json (com o uso) vem depois. Por isso o `RunService` para os runtimes **antes** de gravar `RunFinished`, o `stop()` do stream-json espera até `NEURONS_USAGE_FLUSH_MS` (**4 s**) o turno terminar, e o Hub aceita o uso de uma execução que está se encerrando.

## OpenAPI e cliente tipado

`GET /openapi.json` (OpenAPI 3.1) é montado dos contratos zod dos controllers (`src/api/openapi/build-openapi.ts`), sem subir servidor nem banco. O pacote [`@neurons/api-client`](../../packages/api-client/README.md) guarda o documento (`openapi.json`) e os tipos gerados dele (`openapi-typescript`) e expõe um cliente `openapi-fetch`:

```bash
pnpm api:generate   # regenera packages/api-client (openapi.json e src/schema.gen.ts)
pnpm api:check      # falha se o que está commitado ficou velho (roda no CI)
```

## Demo da API

`pnpm --filter @neurons/server demo` sobe o servidor no próprio processo, publica o `two-terminals.json` (dois agentes de terminal) e roda a execução **pela API**, imprimindo os eventos que chegam pelo WebSocket. O CLI é o de mentira (`packages/agent-runtimes/test-fixtures/fake-claude.mjs`, injetado por `AppConfig.claudeCommand`): não gasta nada e termina em segundos. O código de saída é 0 só se a execução terminar com `finish`. Com `-- --real-claude` usa o Claude Code de verdade (modelo `haiku`, os dois agentes em `stream-json`): **gasta a cota da assinatura**, rode uma vez.

`-- --profile=hybrid` roda **a mesma execução** com o runner em **outro processo** (`demo/runner-process.ts`, que usa o `@neurons/runner`): a demo emite um token, inicia o processo, espera ele se conectar por WebSocket e imprime os mesmos eventos. Só o perfil muda.

## Banco e migrations

O schema fica em `src/database/schema/` e as migrations versionadas em `drizzle/`; as **mesmas** migrations rodam nos dois bancos.

Quem cria o Drizzle é um `DatabaseProvider` (`src/database/database.provider.ts`), com dois adaptadores: `PgliteDatabaseProvider` (`drizzle-orm/pglite`, dados em `<NEURONS_DATA_DIR>/db`) e `PostgresDatabaseProvider` (`pg`). O resto do código recebe um `db` tipado pela base comum do Drizzle (`PgDatabase`) e não sabe qual driver está por trás. O que importa saber:

- **Migrations:** no embutido são aplicadas na partida (o usuário do app não tem como rodar comando); no Postgres, pelo `db:migrate`, para que várias instâncias do servidor na nuvem não disputem a migração.
- **Concorrência:** o PGlite tem uma conexão só; o cliente enfileira as transações, então `send`s simultâneos do Hub serializam (sem erro e sem `seq` repetido). Dentro de `db.transaction`, use sempre o `tx`: usar o `db` por fora trava esperando a própria transação.
- **Encerramento:** o PGlite é fechado no shutdown do Nest (`onApplicationShutdown`), o que grava os arquivos de forma consistente. Só um processo por vez pode usar uma pasta de dados.

```bash
pnpm --filter @neurons/server db:generate -- --name descricao_curta   # gera uma migration a partir do schema
pnpm --filter @neurons/server db:migrate                              # aplica as pendentes no banco da config (com o embutido, o servidor não pode estar rodando)
```

Tabelas: `graphs`, `graph_versions`, `runs`, `messages`, `run_events`, `secrets`, `runners`. Duas regras vivem no próprio banco (migration `immutable_tables`): `graph_versions` e `run_events` rejeitam `UPDATE`, então versões publicadas e o log de eventos são imutáveis mesmo se algum cliente tentar alterá-los.

Os segredos são cifrados com AES-256-GCM (IV aleatório por valor, o nome do segredo entra como dado autenticado). O banco guarda só `ciphertext`, `iv` e `auth_tag`.

## WebSocket (`/ws`)

Mensagens são JSON `{ "event": ..., "data": ... }` nos dois sentidos.

| Direção  | Evento                                       | Observação                                                                                                                                                                                             |
| -------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| cliente  | `subscribe { runId, fromSeq? }`              | `fromSeq` é o primeiro `seq` que o cliente ainda precisa (último visto + 1). Sem ele, só eventos novos.                                                                                                |
| cliente  | `unsubscribe { runId }`                      |                                                                                                                                                                                                        |
| cliente  | `terminal.input { runId, agent, data }`      | Digita no terminal do agente (`agent` é o `name` do bloco). Aceita: **sem resposta**. Recusa: `error` com um dos `code` abaixo. Ver "Digitar no terminal".                                             |
| servidor | `subscribed`, `unsubscribed`                 | Confirmações.                                                                                                                                                                                          |
| servidor | `run.event { runId, seq, type, agent, ... }` | Eventos da execução (as linhas de `run_events`), em ordem de `seq` e sem duplicatas.                                                                                                                   |
| servidor | `run.ephemeral { runId, type, agent, ... }`  | Só ao vivo, **sem `seq`** e fora do log: `TerminalOutput { data, replay }` (saída bruta do terminal; `replay: true` é o resumo enviado a quem assina depois).                                          |
| servidor | `error { code, message }`                    | Mensagem do cliente inválida ou recusada: `invalid_message`, `run_not_running`, `agent_not_in_run`, `not_a_terminal`, `terminal_not_ready`, `terminal_unavailable`, `input_too_large`, `rate_limited`. |

Na reconexão o cliente reenvia `subscribe` com `fromSeq`. O histórico vem de `run_events` e o Hub publica cada evento só depois do commit; a lógica de assinatura está em `src/realtime/run-subscriptions.ts`.

### Eventos que o painel ao vivo usa (T14b)

Além de `RunStarted`, `MessageSent`, `MessageDelivered`, `UsageRecorded`, `AgentStarted`, `AgentFailed`, `GuardTripped`/`GuardWarning` e `RunFinished`, o log tem dois eventos para quem desenha a execução:

- **`AgentStateChanged`** — `agent` = nome do agente, `payload: { state, reason? }`, com `state` em `starting | busy | idle | waiting_reply | failed | finished`. Quem decide cada estado: o **runtime** diz se o agente trabalha (terminal PTY: `UserPromptSubmit` = `busy`, hook `Stop` = `idle`; stream-json: entrega = `busy`, evento `result` = `idle`); o **Hub** diz há quantos `ask` o agente tem abertos (`waiting_reply` dura **enquanto houver algum**, então com dois abertos a primeira resposta não o devolve a `busy`); o **Supervisor** escreve `starting` (junto de `AgentStarted`, na mesma transação), `failed` (com o `reason`, junto de `AgentFailed`) e `finished` (quando a execução para o agente, antes de `RunFinished`). Só é gravado quando o estado muda de verdade, e na ordem em que mudou. Um agente que falhou continua `failed` (não vira `finished`). No perfil `hybrid` o estado do runtime chega pelo `agent.state` do protocolo; o resto (asks, `starting`, `failed`, `finished`) é igual, porque é do servidor.
- **`ToolCalled`** — `agent`, `payload: { tool, inputSummary, durationMs, ok, errorCode }` (`errorCode` é `null` quando deu certo). Gravado por `Hub.reportToolCall`, que `AgentCommunication.reportToolCall` e o `call` `report_tool_call` do protocolo do runner alcançam. `inputSummary` é um resumo **sem segredo**: um valor vindo de `{{secret:NOME}}` aparece como o próprio `{{secret:NOME}}` (só o nome), chaves como `token`/`password`/`authorization` viram `[oculto]`, e os textos são cortados (100 caracteres cada e 300 no total, em `@neurons/tools`; o Hub limita a 1000, e o nome da ferramenta a 100, de qualquer jeito). **Hoje nenhum runtime chama isso sozinho**: as ferramentas do Hub (`send_message`, `ask`, `reply`, `list_peers`, `finish`) já aparecem como mensagens ou como o fim, e as de `@neurons/tools` (HTTP, MCP, Obsidian) passam a gerar o evento quando o runtime de API (T07) ou a configuração MCP da sessão (T09) as ligar, com `onCall: (record) => communication.reportToolCall(record)`.

### Digitar no terminal

`terminal.input` escreve `data` no terminal do agente **exatamente como veio** (teclas, colagem, sequências de controle), no perfil `local` e no `hybrid` (neste, vira o `agent.input` do protocolo do runner). Recusas, na ordem em que são checadas:

| `code`                 | Quando                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_message`      | `runId` não é UUID, falta `agent` ou `data`, ou `data` vazio.                                                                          |
| `rate_limited`         | A conexão passou de `NEURONS_TERMINAL_INPUT_PER_SEC` mensagens por segundo (balde que reabastece nessa taxa).                          |
| `input_too_large`      | `data` tem mais de `NEURONS_TERMINAL_INPUT_MAX_CHARS` caracteres.                                                                      |
| `run_not_running`      | A execução não está em andamento neste servidor (terminou, não existe ou o servidor reiniciou e ainda não a retomou).                  |
| `agent_not_in_run`     | Não há agente com esse nome no grafo da execução.                                                                                      |
| `not_a_terminal`       | O agente é de API ou roda em `stream-json` (sem tela para digitar).                                                                    |
| `terminal_not_ready`   | O agente ainda não subiu (sobe na primeira mensagem) ou o terminal já fechou.                                                          |
| `terminal_unavailable` | O terminal existe mas não aceita agora (o runner do perfil `hybrid` perdeu a conexão): a tecla **não** fica na fila, não tem "depois". |

**O que foi digitado nunca é guardado**: não vai para `run_events`, não entra em log nem na mensagem de erro (pode ser uma senha). Também não há evento de "alguém digitou": uma tecla por mensagem encheria o log; se um dia for preciso, seria um evento por rajada, com a contagem de caracteres e sem o texto. O servidor continua só em `127.0.0.1` e não há login: quem alcança a porta digita.

### Saída do terminal ao reconectar

A saída do terminal é efêmera (não está no log, que é o que faz o `seq` ser confiável). Quem assina recebe, logo depois do histórico, um `run.ephemeral` com `replay: true` e **os últimos ~200 mil caracteres** que cada terminal imprimiu; o que passou enquanto o cliente estava fora entra nesse resumo. **O resumo basta para o xterm.js**: uma TUI como o Claude Code repinta a tela o tempo todo, então reproduzir o fim da saída numa tela nova a deixa igual à que estava. O buffer descarta chunks inteiros da frente (nunca começa no meio de um chunk, nem de uma sequência de escape que o chunk abriu e fechou), tanto no runner embutido quanto no remoto. O cliente deve **trocar** o conteúdo do terminal pelo resumo (não somar) e seguir com os `run.ephemeral` seguintes. Fica uma lacuna conhecida e pequena: no perfil `hybrid`, o que o runner imprimiu enquanto a conexão **runner ↔ servidor** estava caída não chega ao servidor (ele guarda só o que recebeu); a TUI repinta no próximo desenho. Gravar a saída no log foi descartado: seriam centenas de KB por minuto num log que serve de histórico e de replay.

## Estrutura

```
src/
  main.ts, create-app.ts, app.module.ts   entrada e composição
  shared/        config (zod), erros de domínio, filtro HTTP
  database/      DatabaseProvider (PGlite e Postgres), schema Drizzle, migrations
  api/           @Endpoint (contrato zod), validação, conferência da resposta e OpenAPI
  graphs/        GraphService, GraphVersionService e repositórios; controller e contrato
  secrets/       SecretsService, cifra AES-GCM, repositório; controller e contrato
  connections/   estado de autenticação e login oficial Claude Code local
  memories/      catálogo, importação e autorização de ferramentas por agente
  guards/        políticas de mensagem, BudgetGuard, IdleWatchdog, GuardEnforcer
  realtime/      gateway /ws e registro de assinaturas
  agents/        porta AgentRuntime (+ fábrica) e o FakeAgentRuntime dos testes
  run-log/       execuções e log de eventos (seq por execução), publicação após o commit
  hub/           Hub, políticas de mensagem, Supervisor, briefing
  runners/       RemoteAgentRuntime, RunnerLink/RunnerRegistry, gateway /runner, runner embutido, tokens
  runs/          RunService (início e fim), consultas, controller e contrato de /runs
  health/        GET /health
demo/            api-demo.ts: a execução pela API, com os eventos do WebSocket
drizzle/         migrations SQL versionadas
db/              setup-local.sql
```

O domínio (serviços, portas) não conhece Fastify nem HTTP; só `shared/http`, os controllers e o gateway falam o protocolo. A injeção usa `@Inject(...)` explícito em vez de `emitDecoratorMetadata`, porque o Vitest e o `tsx` (esbuild/oxc) não emitem metadados de tipo.

## Hub de mensagens

Agentes ligados por seta conversam direto; o Hub é só o carteiro. Seta A→B: A inicia conversa com B; B sempre pode responder a quem lhe escreveu; seta bidirecional: os dois iniciam. `@human` e `@trigger` escrevem para qualquer agente (os `@` não colidem com nomes de agente).

- **`Hub.send(runId, from, to, kind, body, replyTo?)`** passa pela cadeia de `MessagePolicy` (a primeira é a `PermissionPolicy`, seguida das guardas de mensagem de `src/guards`, montadas em `HubModule` sem mexer no Hub), grava a mensagem e o evento `MessageSent` **na mesma transação** e só depois publica no gateway. O `seq` vem de `runs.last_seq` (`UPDATE ... RETURNING`), então não repete nem deixa buraco; a mensagem guarda o `seq` do seu próprio evento, que define a ordem FIFO da caixa de entrada.
- **Entrega:** o `Supervisor` sobe o agente na primeira mensagem (`AgentStarted` com o briefing) e entrega a caixa de entrada em ordem sempre que o runtime fica `idle`. `delivered_at` é marcado ao entregar; `acked_at` (e o evento `MessageDelivered`) quando o runtime confirma o recebimento. No boot, `Supervisor.recover()` reentrega o que não tem `acked_at` nas execuções `running`.
- **`ask`** devolve uma promessa resolvida pelo `reply` correspondente (que não vai ao runtime) ou rejeitada por `AskTimeoutError`. Uma resposta tardia chega ao agente como mensagem comum. O runtime reporta `waiting_reply` enquanto o `ask` dele está aberto, mas o estado gravado em `AgentStateChanged` vem da contagem de `ask` abertos do Hub (`Hub.openAsksOf`).
- **Fim da execução** (`RunService`): `finish` de um agente (`reason: finished`), quiescência (todos ociosos, sem mensagem pendente nem `ask` aberto: `quiescent`) parada manual (`stopped`) ou guarda (`guard_tripped`). Ao terminar, todos os runtimes são parados (antes de `RunFinished` ser gravado, para o último uso entrar no log).

Um runtime novo implementa `AgentRuntime` (do pacote `@neurons/agent-runtimes`) e é entregue pela `AgentRuntimeFactory`. Os agentes de terminal vêm do `RemoteRuntimeFactory` (rodam num runner, ver "Runners e perfis"); agentes de API usam `ApiRuntimeFactory`, com os SDKs oficiais OpenAI Responses e Anthropic Messages, chave nomeada em `secretName` e o mesmo conjunto de ferramentas de comunicação e memória. O código foi validado com clientes simulados; chamadas pagas com contas reais continuam pendentes.

## Testes

```bash
pnpm --filter @neurons/server test               # unitários + suítes de banco no PGlite, sem Docker (entram no `turbo test`)
pnpm --filter @neurons/server test:integration   # as mesmas suítes de banco em Postgres 18 real
```

As suítes de banco (`*.int.test.ts`: migrations, repositórios, segredos e Hub) são escritas uma vez só e rodam nos dois bancos: o Vitest tem um projeto por banco (`provide: { databaseKind }`) e `startTestDatabase()` abre o que o projeto pede. No `test` rodam em PGlite em memória, sem Docker (então rodam também no CI de Windows e macOS). No `test:integration` rodam em Postgres 18 via Testcontainers, que precisa do **Docker Desktop em execução** (na primeira vez baixa a imagem `postgres:18`). Abrir o PGlite leva alguns segundos (WASM + initdb), por isso os timeouts de 60 s.

## Modelador, conexões e memórias (2026-11-04)

O editor abre em `/new` e cria um projeto vazio. Para servir landing e aplicativo no mesmo processo, faça o build e configure `NEURONS_UI_DIR=apps/web/dist` e `NEURONS_LANDING_DIR=apps/site/dist` com caminhos absolutos. A landing atende `/`, o editor `/new` e `/graphs/:id`, e a API fica sob `/api`. Sem landing configurada, o desktop continua abrindo diretamente a lista de projetos.

- `GET /connections` informa perfil, disponibilidade dos segredos e estado da CLI. `POST /connections/claude/login` inicia o login oficial no computador local. Em perfil híbrido, o login deve ser feito na CLI do runner. Não coleta nem reutiliza tokens privados de assinatura. ChatGPT por assinatura permanece indisponível até implementar e habilitar a integração oficial aplicável.
- `GET/POST /memories` lista e cadastra memórias por UUID. Cofre local só é resolvido no perfil local. Memória de servidor fica em `<dataDir>/memories/<id>/vault`; o manifesto é persistido após a importação completa. Para futura hospedagem, esse diretório precisa de volume persistente. Contas, isolamento entre usuários e sincronização contínua seguem fora desta entrega.
- Importação aceita pasta/ZIP pela interface, com limite de 20 MB e 1000 arquivos, incluindo anexos. Preserva subpastas e links relativos, recusa duplicidade, fuga de diretório e pastas reservadas. Importar cria cópia; não sincroniza. Os agentes leem notas Markdown e links; anexos são preservados, mas não interpretados como conteúdo multimodal.
- O bloco e a ligação `uses` autorizam leitura/escrita. A restrição mais forte prevalece. As ferramentas `list_tools` e `use_tool` passam pelo servidor e usam a versão imutável do grafo da execução. Criar/editar notas não permite exclusão; edição exige conteúdo anterior para detectar conflito. O log guarda operação, bloco e caminho, sem gravar o conteúdo da nota.
- Protocolo do runner: revisão **3**, ainda na versão 1. Runners antigos não recebem chamadas novas ou credenciais de API. Atualize servidor e runner juntos para usar memórias remotas ou chave de API no Claude Code. Credenciais só atravessam o início do agente e não são guardadas no grafo nem no cache do runner.
- Agentes de API registram tokens, mas o custo USD é desconhecido: os SDKs não devolvem a fatura e ainda não há catálogo versionado de preços. As guardas mantêm o aviso de custo desconhecido; não tratar limite em USD como teto garantido nesses agentes.

Detalhes e verificações em [Interface e memórias aprovadas](../../Docs/Plano/Interface%20e%20memorias%20aprovadas.md).
