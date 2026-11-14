# @neurons/providers

Adaptadores de sessão OpenAI Responses, Anthropic Messages e OpenAI Chat Completions compatível. Os SDKs oficiais cuidam do transporte, timeout e retentativas (duas); os objetos dos SDKs ficam dentro deste pacote.

`ProviderRegistry` seleciona o adaptador. Cada sessão mantém mensagens, chamadas e resultados correlacionados pelo ID. `runModelTurn` normaliza a resposta completa em eventos de texto, ferramenta, uso e término.

**Streaming.** `respond(briefing, tools, signal, { onDelta })` pede a resposta em SSE (`stream: true`) e avisa cada pedaço enquanto o modelo escreve: `{ type: "text", text }` (texto livre) e `{ type: "toolArguments", callId, tool, text }` (fragmento do JSON dos argumentos de uma chamada de ferramenta; só é JSON válido inteiro). O resultado final (`ModelTurn`: texto, chamadas, uso) é o mesmo da resposta sem streaming. Sem `onDelta` nada muda (resposta única). Uma resposta cortada (conexão caiu, fim do fluxo sem o evento final: `response.completed`, `message_stop`, `finish_reason`) rejeita com `StreamCutError`; um fluxo mudo por 90 s rejeita com `StreamStalledError` (o timeout de 90 s do SDK só cobre a espera pelo primeiro byte, então um vigia cobre o resto); o `AbortSignal` encerra na hora. As retentativas do SDK (duas) só valem antes de o fluxo abrir, ou seja, antes do primeiro delta: um fluxo que quebra depois não é repetido. No OpenAI-compatível, um servidor que recusa `stream: true`/`stream_options` (400, 404, 405, 415, 422, 501) cai para a resposta única e não tenta streaming de novo naquela sessão. Um `onDelta` que lança exceção não afeta o turno. O servidor mantém as ferramentas de comunicação/autorização e o ciclo dos agentes.

`supportedEffort` só envia esforço para famílias conhecidas, reduz níveis quando necessário e omite o parâmetro para famílias sem suporte ou desconhecidas. Um modelo desconhecido não ganha capacidades presumidas.

`UsageCalculator` usa a tabela versionada em `pricing.ts`. Os preços são estimativas de texto padrão, sem adicionais. Cache OpenAI já faz parte de input; cache Anthropic vem separado. A calculadora evita contagem dupla. Modelos sem preço e contagens inválidas retornam `undefined`, preservando custo desconhecido. Não é uma cotação de fatura nem uma promessa de teto absoluto.

O limite de saída de cada resposta dos adaptadores OpenAI e Anthropic é 8192 tokens por padrão e muda no servidor com `NEURONS_MODEL_MAX_OUTPUT_TOKENS` (256 a 200000); a escolha foi por configuração do operador, e não por campo do agente, para não alterar o esquema dos grafos. Modelos de raciocínio contam o raciocínio nesse limite e podem precisar de mais.

O endpoint compatível é configurado pelo operador no servidor via `NEURONS_OPENAI_COMPATIBLE_BASE_URL`; a URL nunca vem do grafo. Perfis compartilhados também aplicam a política de rede de saída. Para endpoint local sem autenticação, o runtime aceita não selecionar um segredo e usa uma credencial fictícia. Sem a variável, um agente com `openai-compatible` falha ao iniciar a execução com uma mensagem que cita `NEURONS_OPENAI_COMPATIBLE_BASE_URL`.

Testes usam o fetch injetado dos SDKs, sem rede e sem chaves reais. Referências e limites da aceitação estão em [Entrega local sem custo](../../Docs/Plano/Entrega%20local%20sem%20custo.md).
