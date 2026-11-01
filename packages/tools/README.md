# @neurons/tools

Ferramentas que os agentes podem usar (T09). Sem dependência de NestJS nem de `apps/server`:
os agentes de API (T07) chamam `execute` direto no loop; os de terminal (T08) recebem as mesmas
ferramentas pela configuração MCP da sessão.

## Uso

```ts
import { createTools, InMemorySecretResolver } from "@neurons/tools";

const toolSet = await createTools(toolNode, { secrets }); // toolNode: ToolNode do grafo
const result = await toolSet.tools[0].execute(input, {
  signal: AbortSignal.timeout(30_000),
  secrets, // SecretResolver: o servidor implementa em cima do SecretsService
  onCall: (record) => emit("ToolCalled", record), // { tool, inputSummary, durationMs, ok, errorCode? }
});
await toolSet.close(); // encerra processos/conexões
```

`execute` nunca lança: devolve `{ ok: true, content, truncated }` ou `{ ok: false, error: { code, message } }`.
Falhas ao _montar_ o conjunto (`createTools`) lançam `ToolSetupError` com `code`.

## Tipos de ferramenta (`kind`)

| kind       | O que expõe                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `mcp`      | Só as ferramentas de `allowedTools` do servidor MCP (stdio ou HTTP). Falha se o servidor não oferecer alguma. |
| `http`     | Uma ferramenta com o nome do bloco; o agente envia `{ body }`, validado pelo `bodySchema` (Ajv).              |
| `obsidian` | `obsidian_search`, `obsidian_read` e `obsidian_list_links`, somente leitura.                                  |

Para um novo `kind`: criar a fábrica (`ToolFactory<K>`) e registrá-la em `defaultToolFactories`
(`src/create-tools.ts`), ou passá-la em `deps.factories`.

## Decisões

- **Segredos**: `{{secret:NOME}}` é resolvido em url, headers e corpo (HTTP) e no `env` (MCP stdio).
  O corpo vem do agente, então só pode usar segredos que o próprio bloco já referencia na url/headers.
  Os valores são removidos de respostas e erros e nunca entram em `inputSummary` (que também oculta
  chaves como `token`, `password`, `authorization`).
- **Ambiente**: o pacote não lê `process.env`; config e segredos chegam por parâmetro e pelo
  `SecretResolver`. O processo MCP stdio recebe só o `env` do `ToolNode` (com `{{secret:NOME}}`
  resolvido) mais as variáveis mínimas de sistema que o SDK herda por conta própria: no Windows
  `APPDATA`, `HOMEDRIVE`, `HOMEPATH`, `LOCALAPPDATA`, `PATH`, `PROCESSOR_ARCHITECTURE`, `SYSTEMDRIVE`,
  `SYSTEMROOT`, `TEMP`, `USERNAME`, `USERPROFILE`, `PROGRAMFILES`; nos demais `HOME`, `LOGNAME`, `PATH`,
  `SHELL`, `TERM`, `USER`. Nada além disso do servidor chega ao filho (há teste).
- **Limites** (`deps.limits`): `maxResultChars` (20 000), `httpTimeoutMs` (30 s, somado ao `signal`),
  `maxNoteBytes` (1 MiB), `maxSearchFiles` (5 000).
- **Cofre Obsidian**: caminho resolvido com `realpath` e conferido depois de resolvido (recusa `..`,
  caminho absoluto, link simbólico/junction para fora, `.obsidian/`, `.trash/`, arquivos que não são
  `.md`). A busca não segue links simbólicos.
- **MCP stdio no Windows**: o transporte do SDK só encerra o processo direto; um shim `.cmd`
  (`npx.cmd`) deixaria o servidor órfão. Se o servidor não sair em 1 s depois de fechar o stdin,
  a árvore inteira é derrubada com `taskkill /T /F`.

## Scripts

`pnpm --filter @neurons/tools test | typecheck | lint | build`
