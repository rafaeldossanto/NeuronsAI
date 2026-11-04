# @neurons/runner-protocol

O protocolo entre o servidor do NeuronsAI e um **runner**: o processo que hospeda os runtimes dos agentes (terminal e stream-json). Contrato em zod (fonte única: as mesmas definições validam e tipam), versionado, sem dependência de rede: quem fala por WebSocket ou por memória só implementa um `FrameChannel`.

O runner **abre** a conexão (saída), então funciona atrás de NAT. O servidor nunca guarda login de assinatura: o login do Claude Code fica no runner.

## Frames

Todo frame é um objeto JSON com `v` (versão, hoje **1**) e `type`. Um frame de versão desconhecida é recusado antes de qualquer outra leitura (`unsupported_version`); `decodeRunnerFrame`/`decodeServerFrame` devolvem o motivo da recusa **sem repetir o conteúdo** (um frame pode carregar corpo de mensagem).

Runner → servidor:

| `type`         | Para quê                                                                                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register`     | Primeiro frame de toda conexão: nome do runner, capacidades e **os agentes que ele ainda hospeda** (como o servidor se atualiza após uma reconexão).                                                                                     |
| `heartbeat`    | Sinal de vida.                                                                                                                                                                                                                           |
| `agent.state`  | Mudança de estado de um agente (`starting`, `busy`, `idle`, `waiting_reply`, `stopped`, `failed`).                                                                                                                                       |
| `agent.output` | Saída bruta do terminal (efêmera: não é reenviada se a conexão cair).                                                                                                                                                                    |
| `call`         | O agente usa uma ferramenta do Hub (`send_message`, `ask`, `reply`, `list_peers`, `finish`, `report_usage` e, desde a revisão 2, `report_tool_call`: uma chamada de ferramenta do agente, que vira o evento `ToolCalled`). Tem `callId`. |
| `response`     | Resposta a um pedido do servidor (`agent.start`, `agent.deliver`, `agent.stop`).                                                                                                                                                         |

Servidor → runner:

| `type`          | Para quê                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `registered`    | Aceita o runner; diz o intervalo do heartbeat e quais agentes manter (`keep`): o runner para os demais. |
| `reject`        | Recusa (`unauthorized`, `unsupported_protocol`, `invalid_frame`, `not_accepted`) e fecha.               |
| `heartbeat`     | Sinal de vida.                                                                                          |
| `agent.start`   | Sobe um agente (`instanceId`, `runId`, o bloco `agent` do grafo, `briefing`, `settings`).               |
| `agent.deliver` | Entrega uma mensagem da caixa de entrada. `response` só vem quando o runtime confirmou o recebimento.   |
| `agent.stop`    | Encerra o agente.                                                                                       |
| `agent.input`   | O usuário digitou no terminal do agente.                                                                |
| `call.result`   | Resultado de um `call`.                                                                                 |

## Sem perder mensagem na reconexão

Os pedidos do servidor e os `call`s do runner são **idempotentes pelo id** (`requestId`, `callId`, `message.id`, `instanceId`): quem não recebeu a resposta reenvia depois de reconectar, e quem recebe de novo responde igual ao que já fez, sem repetir o efeito. O `register` de cada conexão traz a lista de agentes vivos, então estados perdidos no caminho são recuperados.

## Canais

`FrameChannel<In, Out>` é uma ponta da conexão. `WireChannel` adapta qualquer transporte de texto (WebSocket) e valida cada frame que chega; `createMemoryChannelPair()` liga duas pontas no mesmo processo (o runner embutido do perfil `local`; os frames passam pelo mesmo codec, em ordem, sempre de forma assíncrona).

Códigos de fechamento do WebSocket: `4400` protocolo inválido, `4401` não autorizado, `4403` servidor não aceita runners neste perfil, `4408` sem heartbeat, `4409` outra conexão do mesmo runner assumiu.

## Revisões (mudanças compatíveis)

A **versão** (`v`, hoje 1) só sobe quando um par antigo não consegue ler o frame. Mudança que um par antigo simplesmente não vê (um campo opcional, uma chamada que ele nunca receberá) é uma **revisão** dentro da versão: `PROTOCOL_REVISION` (hoje **2**). Cada ponta anuncia a sua (`register.revision` e `registered.revision`; ausente = 1) e só usa um recurso novo quando a outra já o tem (`revisionOf`, `REVISION_TOOL_CALLS`). O zod ignora campo que não conhece, então um servidor antigo lê o `register` de um runner novo sem reclamar, e um runner novo não manda `report_tool_call` a um servidor que não anunciou a revisão 2 (esse frame, para ele, seria inválido e derrubaria a conexão).

- **1**: o protocolo da T24.
- **2** (T14b): `call` `report_tool_call { report: { tool, inputSummary, durationMs, ok, errorCode? } }`, com os limites do `toolCallReportSchema` (nome até 100 caracteres, resumo até 1000). `agent.state` e `agent.input` já existiam: o estado do agente e o que o usuário digita no terminal passam por eles, sem mudança.

## Versão

`PROTOCOL_VERSION = 1`. Mudança que um par antigo não entende sobe o número; as duas pontas recusam o que não conhecem em vez de adivinhar.
