# `src/runs/live` — a execução ao vivo (T14a e T14c)

Os dados ao vivo de uma execução (cliente do `/ws`, reducer puro, hook) e, por cima deles, o que a tela `/runs/:id` desenha: estado nos blocos, pulso nas setas, painel do agente e terminal. O reducer não tem canvas nem estilo; o replay (T15b) reaproveita o reducer e os componentes abaixo.

```ts
import { useRunLive, reduceRunEvent, initialRunLiveState, selectActivity } from "@/runs/live";
import type { RunLiveState, AgentLiveStatus, LivePulse, ConnectionState } from "@/runs/live";

const { state, connection, error, inputError, sendTerminalInput, clearInputError } =
  useRunLive(runId);
```

## Contrato

| Export                                                                                                       | O que é                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useRunLive(runId)`                                                                                          | `{ state, connection, error, inputError, sendTerminalInput(agent, data), clearInputError() }`                                                                      |
| `reduceRunEvent(state, event)`                                                                               | Reducer **puro** (sem React, relógio nem efeitos). Aceita um evento do log ou um `TerminalChunk`                                                                   |
| `initialRunLiveState`                                                                                        | Estado vazio, ponto de partida do replay                                                                                                                           |
| `selectActivity(state, agent?)`                                                                              | A **linha do tempo única**: mensagens e chamadas de ferramenta em ordem de `seq` (só as de um agente, se passado). Não guarda nada: junta `timeline` e `toolCalls` |
| `RunLiveState`, `AgentLiveStatus`, `LivePulse`, `ConnectionState`                                            | Tipos fixos do contrato                                                                                                                                            |
| `AgentLive`, `LiveMessage`, `LiveToolCall`, `LiveGuardEvent`, `RunLiveFinish`, `RunLogEvent`, `TerminalMeta` | Tipos das partes do estado                                                                                                                                         |

`ConnectionState`: `connecting` (primeira vez) → `live` (assinatura confirmada) → `reconnecting` (caiu) → `closed` (a execução terminou ou a tela saiu).

### `RunLiveState`

- `status`: `pending | running | succeeded | failed | cancelled` (mesmos valores do REST), `finish` (motivo, agente, resultado, guarda, mensagem), `input`, `budgetUsd`, `lastSeq`.
- `agents`: por **nome do agente**, que é o que o servidor grava em `run_events.agent` e em `from`/`to` das mensagens; é o `name` do nó de agente em `graph-schema` (o servidor não usa o `id` do nó). A T14b liga nó e agente por `node.name`. Cada agente: `status`, `stateSource` (`event` quando o estado veio do servidor, `deduced` quando é só dedução), `costUsd` (`number | null`), `turns`, `unknownCostTurns`, `lastSeq`, `failure`.
- `timeline`: mensagens em ordem de `seq` (`from`, `to`, `kind: message | ask | reply`, `preview` de até 200 caracteres, `replyTo`, `delivered`, `at`). `from` pode ser `@human` ou `@trigger`: não são agentes e não entram em `agents`.
- `pulses`: as últimas 20 mensagens como `{ from, to, kind, seq }`, mais antiga primeiro. Para animar cada uma só uma vez, guarde o maior `seq` já animado.
- `totals`: `costUsd` (soma do custo conhecido), `turns`, `unknownCostTurns`; `guardEvents`: `GuardTripped` e `GuardWarning`.
- `terminals`: saída bruta (com sequências de escape) por agente, até 200 mil caracteres, para o xterm.js. Vem do evento efêmero `run.ephemeral` e **não tem `seq`**; o snapshot enviado ao assinar (`replay: true`) substitui o que havia.
- `terminalMeta`: por agente, `{ resets, total }`. `resets` conta os snapshots que trocaram a saída; `total` conta os caracteres recebidos desde o último, mesmo os cortados do início de `terminals` pelo limite. Com isso a tela escreve só o que é novo e sabe quando deve limpar e redesenhar.

**Custo desconhecido nunca vira 0.** `UsageRecorded.costUsd = null` (ou ausente) soma em `unknownCostTurns` e não no custo. Um agente sem nenhum turno com preço tem `costUsd === null`; com preço em alguns turnos, é um mínimo (`unknownCostTurns > 0`).

### Evento → status do agente

Desde a T14b o servidor **transmite** o estado: `AgentStateChanged { state, reason? }`, com `state` em `starting | busy | idle | waiting_reply | failed | finished`, só quando muda. A partir do primeiro desses eventos de um agente, `status` vem **só dele** (`stateSource: "event"`). Um estado que a tela não conhece é ignorado, e um agente que falhou continua `failed`.

A dedução abaixo fica como **reserva** para execuções gravadas antes da T14b (sem `AgentStateChanged`) e vale só para o agente que nunca reportou estado (`stateSource: "deduced"`):

| Evento                                | Efeito (reserva)                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `AgentStarted`                        | `starting`                                                                               |
| `MessageSent` (kind `ask`), do agente | quem perguntou: `waiting_reply`                                                          |
| `MessageSent`, qualquer               | cria o destinatário como `starting` se ainda não existe; entra em `timeline` e `pulses`  |
| `MessageDelivered` ao agente          | `busy` (inclui a resposta que o `ask` esperava)                                          |
| `UsageRecorded`                       | soma o custo; um agente `busy` passa a `idle` (o turno acabou); `waiting_reply` continua |
| `AgentFailed`                         | `failed` (com `failure`), vale sempre                                                    |
| `RunFinished`                         | todo agente que não falhou passa a `finished`; `status` vem do motivo do fim             |
| `GuardTripped` / `GuardWarning`       | só entram em `guardEvents`                                                               |
| `ToolCalled`                          | entra em `toolCalls` (e na linha do tempo, via `selectActivity`)                         |

Os limites da dedução (terminal PTY sem uso fica `busy` até o fim; dois `ask` abertos voltam a `busy` na primeira resposta) não existem com `AgentStateChanged`.

### Idempotência

`reduceRunEvent` ignora um evento com `seq <= state.lastSeq` (devolve o mesmo objeto) e só avança o `lastSeq` num tipo desconhecido. Replay (T15): dobre os eventos de `GET /runs/{id}/events` a partir de `initialRunLiveState`, até o `seq` do cursor.

## Como o histórico chega

O `RunLiveClient` (`run-live-client.ts`) abre o WebSocket na **mesma origem** (`/ws`; no dev o Vite faz proxy com `ws: true`) e manda `subscribe { runId, fromSeq: 1 }`. O servidor responde com o histórico de `run_events` a partir do `seq` 1 e depois com os eventos novos, em ordem e sem lacuna. Foi escolhido em vez do `GET /runs/{id}/events` por ter **um canal só**: com REST + WebSocket seria preciso costurar as duas fontes por `seq` e haveria uma janela de corrida entre a última página e a assinatura.

- Guarda o último `seq` entregue; descarta duplicatas e atrasados (`seq <= último`).
- Um **buraco** (`seq > último + 1`) descarta o evento e força a reconexão, para o servidor reenviar o que faltou.
- Cai a conexão: backoff exponencial (500 ms, 1 s, 2 s… até 15 s, zerado quando a assinatura é confirmada) e novo `subscribe` com `fromSeq = último + 1`.
- Ao ver `RunFinished` a conexão fecha (`closed`) e não reconecta.

## Execução sobre o desenho (T14c)

A tela `/runs/:id` (`runs/run-detail-page.tsx`) abre o **desenho da versão** em que a execução roda (`useRunGraph`: a execução só sabe o id da versão; a lista de versões diz o número e `GET /graphs/{id}/versions/{n}` traz a definição, que é imutável e vem uma vez só).

- **Canvas só leitura** (`graphs/editor/graph-viewer.tsx`): os mesmos blocos (`graphs/editor/nodes.tsx`), setas (`graphs/editor/flow-model.ts`, extraído do editor e usado pelos dois) e anotações do editor, sem arrastar, ligar, apagar nem desenhar. O bloco ganha `data.live` (`BlockLive`: estado, custo e se o custo é um mínimo) e mostra o estado com o ponto âmbar que respira enquanto o agente trabalha. O agente é ligado ao bloco por `node.name`. Clicar num bloco de agente abre o painel; a roda do mouse rola a página (zoom pelos botões ou Ctrl+roda).
- **Pulso** (`graphs/editor/pulse-edge.tsx` + `pulse-edges.ts`): `pulsesByEdge(doc, pulses)` acha a seta de cada pulso, no sentido de quem mandou (`reverse` quando a mensagem vai contra a seta numa ligação de mão dupla; `@trigger` corre pela seta do gatilho; `@human` e pares sem seta ficam de fora). `useActivePulses` anima cada mensagem **uma vez** (guarda o maior `seq`), só se ela é recente (`isFresh`), então o histórico que chega ao abrir a tela não vira uma rajada, com no máximo 12 ao mesmo tempo. A bolinha é SVG `animateMotion` ao longo do caminho da seta, sem JavaScript por quadro nem re-render, e a seta fica âmbar enquanto o pulso passa. Com `prefers-reduced-motion` a bolinha só aparece no meio da seta.
- **Painel do agente** (`agent-panel.tsx`): agente de API mostra a conversa; agente de terminal em `pty` mostra o **terminal ao vivo** (xterm.js 6.0.0, `terminal-view.tsx`) e a conversa embaixo; em `stream-json` não há tela, só a conversa.
- **Terminal:** `TerminalView` usa `terminalMeta` para escrever só o que é novo e, quando `resets` sobe (snapshot `replay` depois de reconectar), faz `reset()` e redesenha com o snapshot, em vez de somar. **Tamanho:** o terminal do servidor tem um tamanho (o menor entre os clientes conectados; ver "Tamanho do terminal" em `apps/server/README.md`), que chega em `terminalMeta[agent].cols/rows` (pelo `TerminalResized` ou pelo `replay`, que traz o tamanho em que foi impresso). A tela xterm **segue esse tamanho** (`terminal.resize`, antes de escrever o resumo) e nunca é ajustada à caixa, porque a TUI de dentro se organiza para o tamanho do PTY. O `@xterm/addon-fit` só **mede** a caixa (`proposeDimensions`, sem `fit()`); quando ela muda (`ResizeObserver`, com 200 ms de debounce, e uma vez ao abrir) o painel manda o tamanho por `sendTerminalResize` → `terminal.resize`, sem repetir o mesmo tamanho nem mandar depois que a execução acabou. O `RunLiveClient` guarda o último tamanho de cada agente e o reenvia ao reassinar, porque o servidor esquece quem saiu. Caixa maior que o terminal: sobra espaço; menor: rola. O que se digita vai por `sendTerminalInput` → `terminal.input` (colagens acima de 4000 caracteres são partidas) e **não é logado nem guardado em lugar nenhum**. As recusas do servidor viram `inputError` em pt-BR (`terminal-errors.ts`: `rate_limited`, `run_not_running`, `not_a_terminal`, `terminal_not_ready`, `terminal_unavailable`, `input_too_large`, `agent_not_in_run`, `invalid_size`, `resize_rate_limited`) e aparecem no painel; a próxima tecla limpa o aviso. Com a execução encerrada o terminal fica só para leitura.
- **Linha do tempo** (`activity-list.tsx`): mensagens e chamadas de ferramenta/memória juntas, a mesma lista na tela (`selectActivity(state)`) e na conversa de cada agente (`selectActivity(state, nome)`). Uma ferramenta mostra operação, agente, caminho, duração e resultado, nunca o conteúdo de uma nota.
- **CSP:** xterm.js usa só estilos inline (permitidos); `script-src` continua `'self'`, sem eval nem script inline.

### Replay (T15b)

Implementado em `replay.ts` (puro), `use-run-events.ts` (carga paginada), `use-replay-player.ts` (cursor, tocar, velocidade) e `replay-controls.tsx`; o contrato acima não mudou. `buildReplay(events)` ordena por `seq`, tira duplicatas, calcula as esperas e guarda um snapshot do estado a cada 50 eventos; `stateAt(replay, n)` dá o estado depois de `n` eventos a partir do snapshot mais próximo; `pulsesBetween(replay, de, para)` dá o pulso do evento que um passo de um evento aplicou (voltar e saltos não têm pulso). Em vez de `useActivePulses` (que lembra o maior `seq` e por isso não repetiria um pulso ao voltar), o player mantém a própria lista, com a mesma duração (`PULSE_TTL_MS`) e teto de 12. Tempo: espera real entre eventos, no mínimo 150 ms e no máximo 2 s em 1×, dividida pela velocidade.

A ideia geral:

`reduceRunEvent` dobrado de `initialRunLiveState` até o `seq` do cursor dá o estado de qualquer instante. Dali saem `liveByNode` (em `run-detail-page.tsx`, estado do bloco), `pulsesByEdge` (passe os `pulses` do instante), `GraphViewer` e `ActivityList`/`selectActivity`. Para animar o replay, passe `isFresh` sempre verdadeiro a `useActivePulses`, ou monte direto o `Record<edgeId, EdgePulse[]>` do passo atual.

### O que a API ainda não tem

- **`terminal.resize`:** feito (T14). Com vários clientes no mesmo terminal vale o menor tamanho entre eles; a regra e o formato estão em `apps/server/README.md`.
- **Saída do terminal é efêmera:** o que passou durante uma queda de conexão só volta no snapshot (`replay`) da reconexão, que é suficiente porque a TUI repinta a tela.

## Testes

`replay.test.tsx` e `runs/run-detail-replay.test.tsx` (replay: estado, linha do tempo e pulso em cada posição, voltar, arrastar, tempo, paginação), `reduce-run-event.test.ts` (fixture em `fixtures/two-terminals-demo.json`, os eventos da demo `pnpm --filter @neurons/server demo` de **antes** da T14b, o que exercita a reserva; mais `AgentStateChanged`, linha do tempo e terminal), `run-live-client.test.ts` (reconexão, duplicatas, fora de ordem, buraco, `terminal.input`) com o `FakeSocket` de `fake-socket.ts`, `pulse-edges.test.ts` (sentido do pulso) e `graphs/editor/pulse-edge.test.tsx`. As telas: `runs/run-detail-page.test.tsx` e `runs/run-detail-live.test.tsx` (blocos, painel e terminal com um xterm de mentira) trocam o `WebSocket` global pelo mesmo falso. O React Flow não desenha setas no jsdom (não há layout), por isso o pulso é testado na seta e no mapeamento, não pela tela inteira.
