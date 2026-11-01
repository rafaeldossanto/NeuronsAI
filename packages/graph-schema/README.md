# @neurons/graph-schema

Contrato central do NeuronsAI: a definição do grafo (JSON) que o modelador web grava e que o servidor lê e valida **com as mesmas funções**. Esquemas em [zod](https://zod.dev) 4; os tipos TypeScript saem de `z.infer`.

## O grafo (`GraphDefinition`)

```ts
{ schemaVersion: 1, id /* uuid */, name, nodes: GraphNode[], links: Link[], annotations: Annotation[] }
```

Todo bloco tem `id` e `position: { x, y }`. Os blocos (`GraphNode`) são uma união discriminada por `type`:

| `type`    | Campos principais                                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trigger` | `kind` (`manual`, `webhook`, `schedule`), `target` (id de um agente), `cron` (obrigatório em `schedule`)                                                         |
| `agent`   | `name` (endereço do `send_message`, `^[A-Za-z][A-Za-z0-9_-]{0,39}$`), `role`, `instructions`, `effort` (`low`…`max`), `budgetUsd?`, `idleTimeoutSec?`, `runtime` |
| `tool`    | `name` e `tool`: `mcp` (`stdio` ou `http`, com `allowedTools`), `http` (`method`, `url`, `headers`, `bodySchema?`) ou `obsidian` (`vaultPath`, `readOnly: true`) |

`runtime` do agente: `{ kind: "api", provider, model }` ou `{ kind: "terminal", cli, command?, args, cwd }` (`cli`: `claude`, `codex`, `gemini` ou `custom`; `command` é obrigatório em `custom`; `cwd` é um caminho absoluto, Windows ou POSIX).

**Ligações (`Link`)**: `{ id, from, to, kind, bidirectional (padrão false), maxMessages? }`.

- `talk`: agente → agente; dá permissão de **iniciar** a conversa. Quem recebe sempre pode responder; `bidirectional` deixa os dois lados iniciarem.
- `uses`: agente → ferramenta.

**Anotações (`Annotation`)**: `rect`, `ellipse`, `arrow`, `text`, `note` e `group` (com `memberIds`). Servem só para desenhar; nunca executam.

## Funções

| Função                      | O que faz                                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateGraph(input)`      | Valida o formato e as regras do grafo. Devolve `{ ok: true, graph }` ou `{ ok: false, issues }` com **todos** os problemas.                                                                                |
| `peersOf(graph, agentName)` | `{ canMessage, canBeMessagedBy }`: com quem o agente pode iniciar conversa e quem pode iniciá-la com ele (`AgentRef = { id, name, role }`).                                                                |
| `toolsOf(graph, agentName)` | Nós de ferramenta ligados ao agente por `uses`.                                                                                                                                                            |
| `migrateGraph(input)`       | Leva um grafo salvo à versão atual, despachando por `schemaVersion` (v1 é identidade). Versão desconhecida lança `GraphMigrationError` (`code`: `unsupported_schema_version` ou `missing_schema_version`). |

`peersOf` e `toolsOf` procuram o agente sem diferenciar maiúsculas e devolvem listas vazias se ele não existir.

### Regras de `validateGraph`

Cada `GraphIssue` tem `code` (inglês, estável), `message` (pt-BR, para a tela) e, quando couber, `path`, `nodeId` e `linkId`.

| `code`                                                 | Regra                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `duplicate_id`                                         | ids únicos entre nós, ligações e anotações                                                                                |
| `duplicate_agent_name`                                 | nomes de agente únicos, sem diferenciar maiúsculas                                                                        |
| `missing_trigger`                                      | pelo menos um gatilho                                                                                                     |
| `trigger_target_not_found`, `trigger_target_not_agent` | o `target` do gatilho é um agente existente                                                                               |
| `link_endpoint_not_found`                              | `from` e `to` apontam para nós existentes                                                                                 |
| `talk_requires_agents`, `talk_to_self`                 | `talk` só entre agentes diferentes                                                                                        |
| `uses_requires_agent_to_tool`                          | `uses` só de agente para ferramenta                                                                                       |
| `duplicate_link`                                       | sem ligação repetida entre o mesmo par e tipo (um `talk` bidirecional A↔B conflita com qualquer outro `talk` entre A e B) |
| `group_member_not_found`                               | `memberIds` de grupo apontam para nós existentes                                                                          |

Erros de formato (campo ausente, tipo errado, regex etc.) saem com o `code` do zod (`invalid_type`, `invalid_value`…) ou com o código próprio (`cron_required`, `command_required`).

## Exemplo

```ts
import { validateGraph, peersOf, toolsOf } from "@neurons/graph-schema";

const result = validateGraph(JSON.parse(json));
if (!result.ok) {
  for (const issue of result.issues) console.error(issue.code, issue.message, issue.path);
} else {
  const { canMessage } = peersOf(result.graph, "Vendedor"); // [{ id, name: "PosVenda", role }]
  const tools = toolsOf(result.graph, "PosVenda"); // [nó da ferramenta HTTP de pedido]
}
```

Exemplos completos em [`examples/`](./examples): `two-agents.json`, `sales-followup.json` e `mixed.json`.

## Desenvolvimento

```bash
pnpm --filter @neurons/graph-schema test
```

Para evoluir o contrato: crie o novo esquema, adicione uma migração em `src/migrate-graph.ts` e atualize `CURRENT_SCHEMA_VERSION`.
