# `src/live` — dados ao vivo de uma execução (T14a)

A camada de dados que a T14b (estado dos agentes e pulso nas setas sobre o canvas) e a T15 (replay) consomem. Não tem canvas nem estilo; só React no hook.

```ts
import { useRunLive, reduceRunEvent, initialRunLiveState } from "@/live";
import type { RunLiveState, AgentLiveStatus, LivePulse, ConnectionState } from "@/live";

const { state, connection, error } = useRunLive(runId);
```

## Contrato

| Export                                                                       | O que é                                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `useRunLive(runId)`                                                          | `{ state: RunLiveState, connection: ConnectionState, error: string \| null }`                    |
| `reduceRunEvent(state, event)`                                               | Reducer **puro** (sem React, relógio nem efeitos). Aceita um evento do log ou um `TerminalChunk` |
| `initialRunLiveState`                                                        | Estado vazio, ponto de partida do replay                                                         |
| `RunLiveState`, `AgentLiveStatus`, `LivePulse`, `ConnectionState`            | Tipos fixos do contrato                                                                          |
| `AgentLive`, `LiveMessage`, `LiveGuardEvent`, `RunLiveFinish`, `RunLogEvent` | Tipos das partes do estado                                                                       |

`ConnectionState`: `connecting` (primeira vez) → `live` (assinatura confirmada) → `reconnecting` (caiu) → `closed` (a execução terminou ou a tela saiu).

### `RunLiveState`

- `status`: `pending | running | succeeded | failed | cancelled` (mesmos valores do REST), `finish` (motivo, agente, resultado, guarda, mensagem), `input`, `budgetUsd`, `lastSeq`.
- `agents`: por **nome do agente**, que é o que o servidor grava em `run_events.agent` e em `from`/`to` das mensagens; é o `name` do nó de agente em `graph-schema` (o servidor não usa o `id` do nó). A T14b liga nó e agente por `node.name`. Cada agente: `status`, `costUsd` (`number | null`), `turns`, `unknownCostTurns`, `lastSeq`, `failure`.
- `timeline`: mensagens em ordem de `seq` (`from`, `to`, `kind: message | ask | reply`, `preview` de até 200 caracteres, `replyTo`, `delivered`, `at`). `from` pode ser `@human` ou `@trigger`: não são agentes e não entram em `agents`.
- `pulses`: as últimas 20 mensagens como `{ from, to, kind, seq }`, mais antiga primeiro. Para animar cada uma só uma vez, guarde o maior `seq` já animado.
- `totals`: `costUsd` (soma do custo conhecido), `turns`, `unknownCostTurns`; `guardEvents`: `GuardTripped` e `GuardWarning`.
- `terminals`: saída bruta (com sequências de escape) por agente, até 200 mil caracteres, para o xterm.js. Vem do evento efêmero `run.ephemeral` e **não tem `seq`**; o snapshot enviado ao assinar (`replay: true`) substitui o que havia.

**Custo desconhecido nunca vira 0.** `UsageRecorded.costUsd = null` (ou ausente) soma em `unknownCostTurns` e não no custo. Um agente sem nenhum turno com preço tem `costUsd === null`; com preço em alguns turnos, é um mínimo (`unknownCostTurns > 0`).

### Evento → status do agente

O servidor não transmite o estado do runtime (`starting/busy/idle/waiting_reply`); ele é deduzido do log:

| Evento                                | Efeito                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `AgentStarted`                        | `starting`                                                                               |
| `MessageSent` (kind `ask`), do agente | quem perguntou: `waiting_reply`                                                          |
| `MessageSent`, qualquer               | cria o destinatário como `starting` se ainda não existe; entra em `timeline` e `pulses`  |
| `MessageDelivered` ao agente          | `busy` (inclui a resposta que o `ask` esperava)                                          |
| `UsageRecorded`                       | soma o custo; um agente `busy` passa a `idle` (o turno acabou); `waiting_reply` continua |
| `AgentFailed`                         | `failed` (com `failure`)                                                                 |
| `RunFinished`                         | todo agente que não falhou passa a `finished`; `status` vem do motivo do fim             |
| `GuardTripped` / `GuardWarning`       | só entram em `guardEvents`                                                               |

Limites conhecidos: um terminal em modo PTY nunca informa uso, então fica `busy` até o fim da execução; e com dois `ask` abertos ao mesmo tempo o agente volta a `busy` na primeira resposta entregue. Corrigir os dois pede um evento de estado do servidor (ver "O que falta na API").

### Idempotência

`reduceRunEvent` ignora um evento com `seq <= state.lastSeq` (devolve o mesmo objeto) e só avança o `lastSeq` num tipo desconhecido. Replay (T15): dobre os eventos de `GET /runs/{id}/events` a partir de `initialRunLiveState`, até o `seq` do cursor.

## Como o histórico chega

O `RunLiveClient` (`run-live-client.ts`) abre o WebSocket na **mesma origem** (`/ws`; no dev o Vite faz proxy com `ws: true`) e manda `subscribe { runId, fromSeq: 1 }`. O servidor responde com o histórico de `run_events` a partir do `seq` 1 e depois com os eventos novos, em ordem e sem lacuna. Foi escolhido em vez do `GET /runs/{id}/events` por ter **um canal só**: com REST + WebSocket seria preciso costurar as duas fontes por `seq` e haveria uma janela de corrida entre a última página e a assinatura.

- Guarda o último `seq` entregue; descarta duplicatas e atrasados (`seq <= último`).
- Um **buraco** (`seq > último + 1`) descarta o evento e força a reconexão, para o servidor reenviar o que faltou.
- Cai a conexão: backoff exponencial (500 ms, 1 s, 2 s… até 15 s, zerado quando a assinatura é confirmada) e novo `subscribe` com `fromSeq = último + 1`.
- Ao ver `RunFinished` a conexão fecha (`closed`) e não reconecta.

## O que falta na API (para a T14b)

- **Chamadas de ferramenta não existem no log.** O servidor só grava mensagens, uso, início, falha, guardas e fim; as ferramentas do Hub (`ask`, `reply`, `finish`, `list_peers`) aparecem como mensagens ou como o fim. Por isso `RunLiveState` ainda não tem uma linha do tempo de ferramentas: precisa de um evento (por exemplo `ToolCalled`) no servidor.
- **Estado do agente é deduzido**, não transmitido (ver acima). Um `AgentStateChanged` no log resolveria os dois limites.
- **Digitar no terminal**: o servidor tem `TerminalSessions.writeInput`, mas nenhum evento do `/ws` nem rota HTTP o expõe; o campo "escreva para o terminal" da T14b precisa disso.
- A saída do terminal é efêmera: o que passou durante uma queda de conexão só volta no snapshot (`replay`) da reconexão.

## Testes

`reduce-run-event.test.ts` (fixture em `fixtures/two-terminals-demo.json`, os eventos da demo `pnpm --filter @neurons/server demo`, com briefings encurtados), `run-live-client.test.ts` (reconexão, duplicatas, fora de ordem, buraco) com o `FakeSocket` de `fake-socket.ts`; a tela é testada em `routes/run-detail-page.test.tsx` trocando o `WebSocket` global por esse mesmo falso.
