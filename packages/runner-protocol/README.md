# @neurons/runner-protocol

O protocolo entre o servidor do NeuronsAI e um **runner**: o processo que hospeda os runtimes dos agentes (terminal e stream-json). Contrato em zod (fonte única: as mesmas definições validam e tipam), versionado, sem dependência de rede: quem fala por WebSocket ou por memória só implementa um `FrameChannel`.

O runner **abre** a conexão (saída), então funciona atrás de NAT. O servidor nunca guarda login de assinatura: o login do Claude Code fica no runner.

## Frames

Todo frame é um objeto JSON com `v` (versão, hoje **1**) e `type`. Um frame de versão desconhecida é recusado antes de qualquer outra leitura (`unsupported_version`); `decodeRunnerFrame`/`decodeServerFrame` devolvem o motivo da recusa **sem repetir o conteúdo** (um frame pode carregar corpo de mensagem).

Runner → servidor:

| `type`          | Para quê                                                                                                                                                                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register`      | Primeiro frame de toda conexão: nome do runner, capacidades e **os agentes que ele ainda hospeda** (como o servidor se atualiza após uma reconexão).                                                                                                                        |
| `heartbeat`     | Sinal de vida.                                                                                                                                                                                                                                                              |
| `agent.state`   | Mudança de estado de um agente (`starting`, `busy`, `idle`, `waiting_reply`, `stopped`, `failed`).                                                                                                                                                                          |
| `agent.output`  | Saída bruta do terminal (efêmera: não é reenviada se a conexão cair).                                                                                                                                                                                                       |
| `agent.resized` | (Revisão 4.) O terminal foi redimensionado, com o tamanho que o runner aplicou. Vem depois do redimensionamento e antes de qualquer saída desenhada para o tamanho novo: o servidor recomeça o buffer do terminal exatamente ali.                                           |
| `agent.delta`   | (Revisão 6.) O que um agente stream-json está escrevendo enquanto o modelo gera: `{ instanceId, turnId, channel: "text" \| "message", delta }`. Só ao vivo, como o `agent.output`: não é guardado nem reenviado após reconexão. O runner agrupa os tokens (cerca de 50 ms). |
| `call`          | O agente usa comunicação (`send_message`, `ask`, `reply`, `list_peers`, `finish`), informa uso (`report_usage`), reporta ferramenta (`report_tool_call`, revisão 2) ou acessa ferramentas do grafo (`list_tools`/`use_tool`, revisão 3). Tem `callId`.                      |
| `response`      | Resposta a um pedido do servidor (`agent.start`, `agent.deliver`, `agent.stop`).                                                                                                                                                                                            |

Servidor → runner:

| `type`          | Para quê                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `registered`    | Aceita o runner; diz o intervalo do heartbeat e quais agentes manter (`keep`): o runner para os demais.                      |
| `reject`        | Recusa (`unauthorized`, `unsupported_protocol`, `invalid_frame`, `not_accepted`) e fecha.                                    |
| `heartbeat`     | Sinal de vida.                                                                                                               |
| `agent.start`   | Sobe um agente (`instanceId`, `runId`, o bloco `agent` do grafo, `briefing`, `settings`).                                    |
| `agent.deliver` | Entrega uma mensagem da caixa de entrada. `response` só vem quando o runtime confirmou o recebimento.                        |
| `agent.stop`    | Encerra o agente.                                                                                                            |
| `agent.input`   | O usuário digitou no terminal do agente.                                                                                     |
| `agent.resize`  | (Revisão 4.) O terminal do agente deve ter este tamanho (`cols`, `rows`). Só é enviado a um runner que anunciou a revisão 4. |
| `call.result`   | Resultado de um `call`.                                                                                                      |

## Sem perder mensagem na reconexão

Os pedidos do servidor e os `call`s do runner são **idempotentes pelo id** (`requestId`, `callId`, `message.id`, `instanceId`): quem não recebeu a resposta reenvia depois de reconectar, e quem recebe de novo responde igual ao que já fez, sem repetir o efeito. O `register` de cada conexão traz a lista de agentes vivos, então estados perdidos no caminho são recuperados.

## Canais

`FrameChannel<In, Out>` é uma ponta da conexão. `WireChannel` adapta qualquer transporte de texto (WebSocket) e valida cada frame que chega; `createMemoryChannelPair()` liga duas pontas no mesmo processo (o runner embutido do perfil `local`; os frames passam pelo mesmo codec, em ordem, sempre de forma assíncrona).

Códigos de fechamento do WebSocket: `4400` protocolo inválido, `4401` não autorizado, `4403` servidor não aceita runners neste perfil, `4408` sem heartbeat, `4409` outra conexão do mesmo runner assumiu.

## Revisões (mudanças compatíveis)

A **versão** (`v`, hoje 1) só sobe quando um par antigo não consegue ler o frame. Mudança que um par antigo simplesmente não vê (um campo opcional, uma chamada que ele nunca receberá) é uma **revisão** dentro da versão: `PROTOCOL_REVISION` (hoje **6**). Cada ponta anuncia a sua (`register.revision` e `registered.revision`; ausente = 1) e só usa um recurso novo quando a outra já o tem (`revisionOf`, `REVISION_TOOL_CALLS`). O zod ignora campo que não conhece, então um servidor antigo lê o `register` de um runner novo sem reclamar, e um runner novo não manda `report_tool_call` a um servidor que não anunciou a revisão 2 (esse frame, para ele, seria inválido e derrubaria a conexão).

- **1**: o protocolo da T24.
- **2** (T14b): `call` `report_tool_call { report: { tool, inputSummary, durationMs, ok, errorCode? } }`, com os limites do `toolCallReportSchema` (nome até 100 caracteres, resumo até 1000). `agent.state` e `agent.input` já existiam: o estado do agente e o que o usuário digita no terminal passam por eles, sem mudança.
- **3**: ferramentas do grafo (`list_tools`/`use_tool`) e credenciais de API transitórias por agente.
- **4** (T14): redimensionamento do terminal. `agent.resize { instanceId, cols, rows }` (servidor → runner) e `agent.resized { instanceId, cols, rows }` (runner → servidor), de 1 a 1000 colunas/linhas no protocolo (o servidor aplica limites menores). Compatível nos dois sentidos: o servidor só manda `agent.resize` a um runner que anunciou revisão 4 (`REVISION_TERMINAL_RESIZE`; para um runner antigo o frame seria inválido e derrubaria a conexão), e o runner só manda `agent.resized` a um servidor que anunciou a 4. Runner novo com servidor antigo, ou o contrário, funcionam: o terminal só fica no tamanho com que abriu (120×40).

- **5**: `agent.snapshot` (a saída recente do terminal, reenviada após a reconexão).
- **6**: `agent.delta` (texto em escrita do stream-json, só ao vivo). O runner só manda o frame a um servidor que anunciou a revisão 6 (`REVISION_OUTPUT_STREAM`; para um servidor da 5 ou anterior o frame seria inválido e derrubaria a conexão). Servidor novo com runner antigo: o runner simplesmente nunca manda. Nos dois casos os agentes funcionam, só sem o texto ao vivo.

## Versão

`PROTOCOL_VERSION = 1`. Mudança que um par antigo não entende sobe o número; as duas pontas recusam o que não conhecem em vez de adivinhar.
