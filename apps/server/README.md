# @neurons/server

Servidor do NeuronsAI: NestJS 12 com adaptador Fastify, Postgres via Drizzle ORM e um gateway WebSocket para eventos de execução. Escuta **somente em `127.0.0.1`**.

O Hub de mensagens (T06) e os runtimes de terminal do Claude Code (T08, pacote `@neurons/agent-runtimes`) estão prontos; o runtime de API chega na T07 e a API REST na T10.

## Variáveis de ambiente

Copie `.env.example` para `.env` (ignorado pelo git) e preencha. Valores vazios contam como "não definido". Qualquer valor inválido derruba o processo na partida, com uma mensagem listando todos os problemas.

| Variável                  | Padrão | Descrição                                                                                 |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `NEURONS_MODE`            | `all`  | `api`, `worker` ou `all`. Por ora só decide quais módulos sobem (ver abaixo).             |
| `NEURONS_PORT`            | `3100` | Porta em `127.0.0.1`.                                                                     |
| `NEURONS_ASK_TIMEOUT_SEC` | `120`  | Segundos que um `ask` espera pela resposta antes de falhar.                               |
| `NEURONS_CLAUDE_BIN`      | —      | Caminho do executável do Claude Code usado pelos agentes de terminal. Vazio: procura sozinho (PATH, pastas dos instaladores e, no Windows, a CLI embutida no app desktop). |
| `NEURONS_DB_URL`          | —      | URL completa do Postgres. Tem prioridade sobre as variáveis abaixo.                       |
| `NEURONS_DB_HOST`         | —      | Host do banco.                                                                            |
| `NEURONS_DB_PORT`         | `5432` | Porta do banco.                                                                           |
| `NEURONS_DB_USER`         | —      | Usuário do banco.                                                                         |
| `NEURONS_DB_NAME`         | —      | Nome do database.                                                                         |
| `NEURONS_DB_PASSWORD`     | —      | Senha do banco.                                                                           |
| `NEURONS_MASTER_KEY`      | —      | Chave AES-256 (32 bytes em base64) que cifra os segredos. Sem ela, só os segredos falham. |

Sem nenhuma variável de banco o servidor sobe normalmente e `GET /health` informa `database.status = "not_configured"`. O mesmo vale para a chave mestra. Para gerar uma chave:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

### Modos

| Modo     | Módulos                                               |
| -------- | ----------------------------------------------------- |
| `api`    | comuns + `graphs`, `realtime`                         |
| `worker` | comuns + `runs` (Hub, Supervisor e ciclo da execução) |
| `all`    | tudo                                                  |

Módulos comuns: `database`, `secrets`, `health`. Em qualquer modo o processo escuta HTTP em `127.0.0.1`.

## Criar o banco (uma vez)

Requer o Postgres 18 local. O script `db/setup-local.sql` cria o usuário `neurons` e o database `neurons_dev`. Ele é idempotente (pode rodar de novo; a senha do usuário é redefinida) e recebe a senha por parâmetro, sem gravá-la em arquivo. Rode como superusuário `postgres` (o `psql` pede a senha dele):

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -v neurons_password="ESCOLHA_UMA_SENHA" -f apps/server/db/setup-local.sql
```

Depois configure o `.env` do servidor:

```dotenv
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

Verificação rápida: `http://127.0.0.1:3100/health`. Retorna 200 com `status: "ok"` (inclusive sem banco configurado) ou 503 com `status: "degraded"` quando o banco está configurado mas não responde. Erros HTTP têm sempre o formato `{ "code": "...", "message": "..." }`.

## Banco e migrations

O schema fica em `src/database/schema/` e as migrations versionadas em `drizzle/`.

```bash
pnpm --filter @neurons/server db:generate -- --name descricao_curta   # gera uma migration a partir do schema
pnpm --filter @neurons/server db:migrate                              # aplica as pendentes
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
  database/      pool, schema Drizzle, migrator
  graphs/        GraphVersionService + repositórios (porta e adaptador Drizzle)
  secrets/       SecretsService, cifra AES-GCM, repositório
  realtime/      gateway /ws e registro de assinaturas
  agents/        porta AgentRuntime (+ fábrica) e o FakeAgentRuntime dos testes
  run-log/       execuções e log de eventos (seq por execução), publicação após o commit
  hub/           Hub, políticas de mensagem, Supervisor, briefing
  runs/          RunService: início e fim da execução
  health/        GET /health
drizzle/         migrations SQL versionadas
db/              setup-local.sql
```

O domínio (serviços, portas) não conhece Fastify nem HTTP; só `shared/http`, os controllers e o gateway falam o protocolo. A injeção usa `@Inject(...)` explícito em vez de `emitDecoratorMetadata`, porque o Vitest e o `tsx` (esbuild/oxc) não emitem metadados de tipo.

## Hub de mensagens

Agentes ligados por seta conversam direto; o Hub é só o carteiro. Seta A→B: A inicia conversa com B; B sempre pode responder a quem lhe escreveu; seta bidirecional: os dois iniciam. `@human` e `@trigger` escrevem para qualquer agente (os `@` não colidem com nomes de agente).

- **`Hub.send(runId, from, to, kind, body, replyTo?)`** passa pela cadeia de `MessagePolicy` (a primeira é a `PermissionPolicy`; limites e anti pingue-pongue da T10 entram como novas políticas em `HubModule`, sem mexer no Hub), grava a mensagem e o evento `MessageSent` **na mesma transação** e só depois publica no gateway. O `seq` vem de `runs.last_seq` (`UPDATE ... RETURNING`), então não repete nem deixa buraco; a mensagem guarda o `seq` do seu próprio evento, que define a ordem FIFO da caixa de entrada.
- **Entrega:** o `Supervisor` sobe o agente na primeira mensagem (`AgentStarted` com o briefing) e entrega a caixa de entrada em ordem sempre que o runtime fica `idle`. `delivered_at` é marcado ao entregar; `acked_at` (e o evento `MessageDelivered`) quando o runtime confirma o recebimento. No boot, `Supervisor.recover()` reentrega o que não tem `acked_at` nas execuções `running`.
- **`ask`** devolve uma promessa resolvida pelo `reply` correspondente (que não vai ao runtime) ou rejeitada por `AskTimeoutError`. Uma resposta tardia chega ao agente como mensagem comum. O runtime reporta `waiting_reply` enquanto o `ask` dele está aberto.
- **Fim da execução** (`RunService`): `finish` de um agente (`reason: finished`), quiescência (todos ociosos, sem mensagem pendente nem `ask` aberto: `quiescent`) ou parada manual (`stopped`). Ao terminar, todos os runtimes são parados.

Um runtime novo implementa `AgentRuntime` (`src/agents/agent-runtime.ts`) e é entregue pela `AgentRuntimeFactory`; enquanto T07/T08 não existem, a fábrica padrão recusa qualquer agente.

## Testes

```bash
pnpm --filter @neurons/server test               # unitários, sem banco (entram no `turbo test`)
pnpm --filter @neurons/server test:integration   # migrations, repositórios e Hub em Postgres 18 real
```

Os testes de integração (`*.int.test.ts`) usam Testcontainers e precisam do **Docker Desktop em execução**; ficam fora do `turbo test`. Na primeira vez, baixam a imagem `postgres:18`.
