# @neurons/runner-protocol

O protocolo entre o servidor do NeuronsAI e um **runner**: o processo que hospeda os runtimes dos agentes (terminal e stream-json). Contrato em zod (fonte única: as mesmas definições validam e tipam), versionado, sem dependência de rede: quem fala por WebSocket ou por memória só implementa um `FrameChannel`.

O runner **abre** a conexão (saída), então funciona atrás de NAT. O servidor nunca guarda login de assinatura: o login do Claude Code fica no runner.

## Frames

Todo frame é um objeto JSON com `v` (versão, hoje **1**) e `type`. Um frame de versão desconhecida é recusado antes de qualquer outra leitura (`unsupported_version`); `decodeRunnerFrame`/`decodeServerFrame` devolvem o motivo da recusa **sem repetir o conteúdo** (um frame pode carregar corpo de mensagem).

Runner → servidor:

| `type`         | Para quê                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register`     | Primeiro frame de toda conexão: nome do runner, capacidades e **os agentes que ele ainda hospeda** (como o servidor se atualiza após uma reconexão). |
| `heartbeat`    | Sinal de vida.                                                                                                                                       |
| `agent.state`  | Mudança de estado de um agente (`starting`, `busy`, `idle`, `waiting_reply`, `stopped`, `failed`).                                                   |
| `agent.output` | Saída bruta do terminal (efêmera: não é reenviada se a conexão cair).                                                                                |
| `call`         | O agente usa uma ferramenta do Hub (`send_message`, `ask`, `reply`, `list_peers`, `finish`, `report_usage`). Tem `callId`.                           |
| `response`     | Resposta a um pedido do servidor (`agent.start`, `agent.deliver`, `agent.stop`).                                                                     |

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

## Versão

`PROTOCOL_VERSION = 1`. Mudança que um par antigo não entende sobe o número; as duas pontas recusam o que não conhecem em vez de adivinhar.
