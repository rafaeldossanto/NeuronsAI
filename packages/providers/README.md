# @neurons/providers

Adaptadores de sessão OpenAI Responses, Anthropic Messages e OpenAI Chat Completions compatível. Os SDKs oficiais cuidam do transporte, timeout e retentativas (duas); os objetos dos SDKs ficam dentro deste pacote.

`ProviderRegistry` seleciona o adaptador. Cada sessão mantém mensagens, chamadas e resultados correlacionados pelo ID. `runModelTurn` normaliza a resposta completa em eventos de texto, ferramenta, uso e término; não é streaming incremental de tokens. O servidor mantém as ferramentas de comunicação/autorização e o ciclo dos agentes.

`supportedEffort` só envia esforço para famílias conhecidas, reduz níveis quando necessário e omite o parâmetro para famílias sem suporte ou desconhecidas. Um modelo desconhecido não ganha capacidades presumidas.

`UsageCalculator` usa a tabela versionada em `pricing.ts`. Os preços são estimativas de texto padrão, sem adicionais. Cache OpenAI já faz parte de input; cache Anthropic vem separado. A calculadora evita contagem dupla. Modelos sem preço e contagens inválidas retornam `undefined`, preservando custo desconhecido. Não é uma cotação de fatura nem uma promessa de teto absoluto.

O limite de saída de cada resposta dos adaptadores OpenAI e Anthropic é 8192 tokens por padrão e muda no servidor com `NEURONS_MODEL_MAX_OUTPUT_TOKENS` (256 a 200000); a escolha foi por configuração do operador, e não por campo do agente, para não alterar o esquema dos grafos. Modelos de raciocínio contam o raciocínio nesse limite e podem precisar de mais.

O endpoint compatível é configurado pelo operador no servidor via `NEURONS_OPENAI_COMPATIBLE_BASE_URL`; a URL nunca vem do grafo. Perfis compartilhados também aplicam a política de rede de saída. Para endpoint local sem autenticação, o runtime aceita não selecionar um segredo e usa uma credencial fictícia. Sem a variável, um agente com `openai-compatible` falha ao iniciar a execução com uma mensagem que cita `NEURONS_OPENAI_COMPATIBLE_BASE_URL`.

Testes usam o fetch injetado dos SDKs, sem rede e sem chaves reais. Referências e limites da aceitação estão em [Entrega local sem custo](../../Docs/Plano/Entrega%20local%20sem%20custo.md).
