# @neurons/api-client

Cliente TypeScript tipado da API do servidor (`apps/server`), para o `apps/web` e para scripts. Os tipos vêm do documento OpenAPI do servidor, que por sua vez vem dos mesmos schemas zod que validam os pedidos: um contrato só, sem DTO escrito à mão.

```ts
import { createApiClient } from "@neurons/api-client";

const api = createApiClient("http://127.0.0.1:3100");

const { data, error } = await api.GET("/graphs/{id}", { params: { path: { id } } });
// `data` é o grafo; `error` é { code, message, details? } (o formato único de erro da API)

await api.POST("/runs", { body: { graphVersionId, input: "comece" } });
```

Usa [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) (cerca de 6 kB, sem geração de código em runtime) e [`openapi-typescript`](https://openapi-ts.dev/) para os tipos. Os eventos ao vivo não passam por aqui: vêm pelo WebSocket (`/ws`).

## Arquivos gerados (vão no git)

| Arquivo             | O que é                                                 |
| ------------------- | ------------------------------------------------------- |
| `openapi.json`      | O documento OpenAPI 3.1, montado do código do servidor. |
| `src/schema.gen.ts` | Os tipos (`paths`, `components`, `operations`) dele.    |

```bash
pnpm api:generate   # regenera os dois (rode depois de mudar um contrato no servidor)
pnpm api:check      # só confere: sai com 1 se algum estiver velho (roda no CI)
```

A geração roda o servidor **como código** (`apps/server/src/api/openapi/emit-cli.ts`), sem subir porta nem banco.
