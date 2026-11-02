# @neurons/server

Servidor do NeuronsAI: NestJS 12 com adaptador Fastify, Drizzle ORM sobre um banco embutido (PGlite) ou Postgres, e um gateway WebSocket para eventos de execução. Escuta **somente em endereços locais** (`127.0.0.1` por padrão) porque ainda não há login.

O Hub de mensagens (T06), os runtimes de terminal do Claude Code (T08, pacote `@neurons/agent-runtimes`), as guardas e a API REST (T10) estão prontos; o runtime de API chega na T07.

## Variáveis de ambiente

Copie `.env.example` para `.env` (ignorado pelo git) e preencha. Valores vazios contam como "não definido". Qualquer valor inválido derruba o processo na partida, com uma mensagem listando todos os problemas.

| Variável                     | Padrão      | Descrição                                                                                                                                                                  |
| ---------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEURONS_MODE`               | `all`       | `api`, `worker` ou `all`. Por ora só decide quais módulos sobem (ver abaixo).                                                                                              |
| `NEURONS_HOST`               | `127.0.0.1` | Onde escutar. Qualquer endereço que não seja local (`127.x`, `::1`, `localhost`) exige também `NEURONS_ALLOW_REMOTE=true`: sem login, quem alcança a porta usa a API.      |
| `NEURONS_ALLOW_REMOTE`       | `false`     | Confirma que o servidor pode escutar fora desta máquina.                                                                                                                   |
| `NEURONS_PORT`               | `3100`      | Porta do servidor.                                                                                                                                                         |
| `NEURONS_RUN_MAX_MESSAGES`   | `200`       | Mensagens (de qualquer tipo) que uma execução troca antes de ser parada pela guarda.                                                                                       |
| `NEURONS_PING_PONG_MESSAGES` | `20`        | Mensagens seguidas entre os mesmos dois agentes, sem ninguém mais, até a guarda de pingue-pongue parar a execução (mínimo 2).                                              |
| `NEURONS_RUN_BUDGET_USD`     | —           | Orçamento em US$ de uma execução que não define o seu. Vazio: sem limite.                                                                                                  |
| `NEURONS_USAGE_FLUSH_MS`     | `4000`      | Ao parar, quanto tempo esperar o turno que estava em andamento terminar e informar o uso (o custo da última resposta chega depois do `finish`).                            |
| `NEURONS_ASK_TIMEOUT_SEC`    | `120`       | Segundos que um `ask` espera pela resposta antes de falhar.                                                                                                                |
| `NEURONS_CLAUDE_BIN`         | —           | Caminho do executável do Claude Code usado pelos agentes de terminal. Vazio: procura sozinho (PATH, pastas dos instaladores e, no Windows, a CLI embutida no app desktop). |
| `NEURONS_DB`                 | `embedded`  | `embedded` (PGlite, dentro do processo) ou `postgres`. As variáveis `NEURONS_DB_*` abaixo só valem com `postgres`.                                                         |
| `NEURONS_DATA_DIR`           | por sistema | Pasta de dados do app (ver abaixo). O banco embutido fica em `<pasta>/db`.                                                                                                 |
| `NEURONS_DB_URL`             | —           | URL completa do Postgres. Tem prioridade sobre as variáveis abaixo.                                                                                                        |
| `NEURONS_DB_HOST`            | —           | Host do banco.                                                                                                                                                             |
| `NEURONS_DB_PORT`            | `5432`      | Porta do banco.                                                                                                                                                            |
| `NEURONS_DB_USER`            | —           | Usuário do banco.                                                                                                                                                          |
| `NEURONS_DB_NAME`            | —           | Nome do database.                                                                                                                                                          |
| `NEURONS_DB_PASSWORD`        | —           | Senha do banco.                                                                                                                                                            |
| `NEURONS_MASTER_KEY`         | —           | Chave AES-256 (32 bytes em base64) que cifra os segredos. Sem ela, só os segredos falham.                                                                                  |

Por padrão (`NEURONS_DB=embedded`) o servidor sobe **sem Postgres nenhum**: o banco é o PGlite e as migrations são aplicadas na partida. Com `NEURONS_DB=postgres` e nenhuma variável `NEURONS_DB_*` o servidor também sobe, e `GET /health` informa `database.status = "not_configured"`. O mesmo vale para a chave mestra.

Pasta de dados padrão (quando `NEURONS_DATA_DIR` está vazio):

| Sistema | Pasta                                                    |
| ------- | -------------------------------------------------------- |
| Windows | `%APPDATA%\NeuronsAI`                                    |
| macOS   | `~/Library/Application Support/NeuronsAI`                |
| Linux   | `$XDG_DATA_HOME/neuronsai` ou `~/.local/share/neuronsai` |

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

| Método e caminho                                    | O que faz                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET/POST /graphs`, `GET/PATCH/DELETE /graphs/{id}` | CRUD de grafos (nome e rascunho). Só apaga grafo sem versões publicadas (`409 graph_has_versions`).                                                                            |
| `GET /graphs/{id}/versions`, `GET .../{version}`    | Versões publicadas (imutáveis).                                                                                                                                                |
| `POST /graphs/{id}/versions`                        | Valida com o `validateGraph` e congela a próxima versão. Sem `definition`, publica o rascunho. Inválido: `400 invalid_graph` com `details` apontando o que corrigir.           |
| `POST /runs`, `GET /runs`, `GET /runs/{id}`         | Inicia uma execução de uma versão (`graphVersionId`, `input`, `triggerId?`, `budgetUsd?`), lista (`status`, `graphId`, `limit`) e detalha (motivo do fim, consumo por agente). |
| `POST /runs/{id}/stop`                              | Para a execução: encerra os runtimes e os terminais (`RunService` → `Supervisor.stopRun`). Pode repetir.                                                                       |
| `POST /runs/{id}/messages`                          | Manda uma mensagem como `@human` a qualquer agente da execução (as setas não valem para você).                                                                                 |
| `GET /runs/{id}/messages`, `GET /runs/{id}/events`  | Mensagens e eventos em ordem (`afterSeq`/`fromSeq`, `limit`): o mesmo log que o WebSocket transmite.                                                                           |
| `GET /secrets`, `PUT /secrets/{name}`               | **Só** nomes e escrita. O valor entra e nunca volta: nenhum schema de resposta o carrega, e erros de validação não repetem o que foi enviado.                                  |
| `GET /openapi.json`, `GET /health`                  | Documento OpenAPI e saúde.                                                                                                                                                     |

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

Tabelas: `graphs`, `graph_versions`, `runs`, `messages`, `run_events`, `secrets`. Duas regras vivem no próprio banco (migration `immutable_tables`): `graph_versions` e `run_events` rejeitam `UPDATE`, então versões publicadas e o log de eventos são imutáveis mesmo se algum cliente tentar alterá-los.

Os segredos são cifrados com AES-256-GCM (IV aleatório por valor, o nome do segredo entra como dado autenticado). O banco guarda só `ciphertext`, `iv` e `auth_tag`.

## WebSocket (`/ws`)

Mensagens são JSON `{ "event": ..., "data": ... }` nos dois sentidos.

| Direção  | Evento                                | Observação                                                                                              |
| -------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| cliente  | `subscribe { runId, fromSeq? }`       | `fromSeq` é o primeiro `seq` que o cliente ainda precisa (último visto + 1). Sem ele, só eventos novos. |
| cliente  | `unsubscribe { runId }`               |                                                                                                         |
| servidor | `subscribed`, `unsubscribed`          | Confirmações.                                                                                           |
| servidor | `run.event { runId, seq, type, ... }` | Eventos da execução, em ordem de `seq` e sem duplicatas.                                                |
| servidor | `error { code, message }`             | Mensagem do cliente inválida.                                                                           |

Na reconexão o cliente reenvia `subscribe` com `fromSeq`. O histórico vem de `run_events` e o Hub publica cada evento só depois do commit; a lógica de assinatura está em `src/realtime/run-subscriptions.ts`.

## Estrutura

```
src/
  main.ts, create-app.ts, app.module.ts   entrada e composição
  shared/        config (zod), erros de domínio, filtro HTTP
  database/      DatabaseProvider (PGlite e Postgres), schema Drizzle, migrations
  api/           @Endpoint (contrato zod), validação, conferência da resposta e OpenAPI
  graphs/        GraphService, GraphVersionService e repositórios; controller e contrato
  secrets/       SecretsService, cifra AES-GCM, repositório; controller e contrato
  guards/        políticas de mensagem, BudgetGuard, IdleWatchdog, GuardEnforcer
  realtime/      gateway /ws e registro de assinaturas
  agents/        porta AgentRuntime (+ fábrica) e o FakeAgentRuntime dos testes
  run-log/       execuções e log de eventos (seq por execução), publicação após o commit
  hub/           Hub, políticas de mensagem, Supervisor, briefing
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
- **`ask`** devolve uma promessa resolvida pelo `reply` correspondente (que não vai ao runtime) ou rejeitada por `AskTimeoutError`. Uma resposta tardia chega ao agente como mensagem comum. O runtime reporta `waiting_reply` enquanto o `ask` dele está aberto.
- **Fim da execução** (`RunService`): `finish` de um agente (`reason: finished`), quiescência (todos ociosos, sem mensagem pendente nem `ask` aberto: `quiescent`) parada manual (`stopped`) ou guarda (`guard_tripped`). Ao terminar, todos os runtimes são parados (antes de `RunFinished` ser gravado, para o último uso entrar no log).

Um runtime novo implementa `AgentRuntime` (do pacote `@neurons/agent-runtimes`) e é entregue pela `AgentRuntimeFactory`; enquanto o runtime de API (T07) não existe, a fábrica recusa agentes `api`.

## Testes

```bash
pnpm --filter @neurons/server test               # unitários + suítes de banco no PGlite, sem Docker (entram no `turbo test`)
pnpm --filter @neurons/server test:integration   # as mesmas suítes de banco em Postgres 18 real
```

As suítes de banco (`*.int.test.ts`: migrations, repositórios, segredos e Hub) são escritas uma vez só e rodam nos dois bancos: o Vitest tem um projeto por banco (`provide: { databaseKind }`) e `startTestDatabase()` abre o que o projeto pede. No `test` rodam em PGlite em memória, sem Docker (então rodam também no CI de Windows e macOS). No `test:integration` rodam em Postgres 18 via Testcontainers, que precisa do **Docker Desktop em execução** (na primeira vez baixa a imagem `postgres:18`). Abrir o PGlite leva alguns segundos (WASM + initdb), por isso os timeouts de 60 s.
