# @neurons/server

Servidor do NeuronsAI: NestJS 11 com adaptador Fastify, Postgres via Drizzle ORM e um gateway WebSocket para eventos de execução. Escuta **somente em `127.0.0.1`**.

Nesta etapa (T03) existem apenas o esqueleto e a persistência. O Hub, os runtimes de agentes e a API REST completa chegam nas tarefas T06–T08 e T10.

## Variáveis de ambiente

Copie `.env.example` para `.env` (ignorado pelo git) e preencha. Valores vazios contam como "não definido". Qualquer valor inválido derruba o processo na partida, com uma mensagem listando todos os problemas.

| Variável              | Padrão | Descrição                                                                                 |
| --------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `NEURONS_MODE`        | `all`  | `api`, `worker` ou `all`. Por ora só decide quais módulos sobem (ver abaixo).             |
| `NEURONS_PORT`        | `3100` | Porta em `127.0.0.1`.                                                                     |
| `NEURONS_DB_URL`      | —      | URL completa do Postgres. Tem prioridade sobre as variáveis abaixo.                       |
| `NEURONS_DB_HOST`     | —      | Host do banco.                                                                            |
| `NEURONS_DB_PORT`     | `5432` | Porta do banco.                                                                           |
| `NEURONS_DB_USER`     | —      | Usuário do banco.                                                                         |
| `NEURONS_DB_NAME`     | —      | Nome do database.                                                                         |
| `NEURONS_DB_PASSWORD` | —      | Senha do banco.                                                                           |
| `NEURONS_MASTER_KEY`  | —      | Chave AES-256 (32 bytes em base64) que cifra os segredos. Sem ela, só os segredos falham. |

Sem nenhuma variável de banco o servidor sobe normalmente e `GET /health` informa `database.status = "not_configured"`. O mesmo vale para a chave mestra. Para gerar uma chave:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

### Modos

| Modo     | Módulos                                                |
| -------- | ------------------------------------------------------ |
| `api`    | comuns + `graphs`, `realtime`                          |
| `worker` | comuns (os módulos de execução entram a partir da T06) |
| `all`    | tudo                                                   |

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

Na reconexão o cliente reenvia `subscribe` com `fromSeq`. Enquanto o Hub não existe, o histórico é vazio e nada publica eventos; a lógica de assinatura está em `src/realtime/run-subscriptions.ts`.

## Estrutura

```
src/
  main.ts, create-app.ts, app.module.ts   entrada e composição
  shared/        config (zod), erros de domínio, filtro HTTP
  database/      pool, schema Drizzle, migrator
  graphs/        GraphVersionService + repositórios (porta e adaptador Drizzle)
  secrets/       SecretsService, cifra AES-GCM, repositório
  realtime/      gateway /ws e registro de assinaturas
  health/        GET /health
drizzle/         migrations SQL versionadas
db/              setup-local.sql
```

O domínio (serviços, portas) não conhece Fastify nem HTTP; só `shared/http`, os controllers e o gateway falam o protocolo. A injeção usa `@Inject(...)` explícito em vez de `emitDecoratorMetadata`, porque o Vitest e o `tsx` (esbuild/oxc) não emitem metadados de tipo.

## Testes

```bash
pnpm --filter @neurons/server test               # unitários, sem banco (entram no `turbo test`)
pnpm --filter @neurons/server test:integration   # migrations + repositórios em Postgres 18 real
```

Os testes de integração (`*.int.test.ts`) usam Testcontainers e precisam do **Docker Desktop em execução**; ficam fora do `turbo test`. Na primeira vez, baixam a imagem `postgres:18`.
