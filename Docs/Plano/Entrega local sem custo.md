# Entrega local sem custo — 06/11/2026

Continuação autorizada na ordem T21 → T07 → T25 → T09 → T24 → T18/T22. Os testes usam bancos temporários, respostas simuladas dos SDKs e uma CLI de teste. Não houve chamada paga, publicação de release, criação de infraestrutura ou contratação de serviços.

| Tarefa | Implementação desta rodada | Aceitação externa que continua separada |
| --- | --- | --- |
| T21 | O Hub drena agentes em `beforeApplicationShutdown`, antes do fechamento do banco e dos runners. A API encerra conexões HTTP ainda abertas ao fechar. Há regressão com banco real embutido e cliente HTTP incompleto. | Aceitação com Claude Code real, instalação do usuário e os demais sistemas. |
| T07 | Adaptadores OpenAI Responses e Anthropic extraídos para `packages/providers`; registro de provedores, cliente Chat Completions compatível, eventos normalizados de resposta, tradução conservadora de esforço e calculadora de uso com tabela versionada. | Spike real T04 e os fluxos com chaves reais. A normalização acontece por resposta completa, sem prometer streaming incremental de tokens. |
| T25 | Painel de convites por e-mail com criação/cancelamento e papéis; autorização declarada por controller/rota; rotação do segredo de webhook exige gerenciamento de credenciais. Corpos comuns limitados a 1 MiB; importação de memórias mantém 30 MiB. | Google real e aceitação do cofre/reabertura nos três sistemas. |
| T09 | Hooks PreToolUse, PostToolUse e PostToolUseFailure em PTY e stream-json. Ferramentas nativas produzem ToolCalled; argumentos e resultados não entram no relatório. Chamadas do MCP neurons são ignoradas pelo hook para evitar contagem duplicada. | Confirmar os hooks na versão real da CLI instalada. |
| T24 | `runtime.runnerId` opcional no agente e no inspetor; seleção exata sem atravessar organizações. Revisão 5 do protocolo envia snapshot recente e tamanho do terminal após reconectar. Pares antigos mantêm o comportamento anterior. | Execução híbrida e fluxo misto reais. O snapshot recupera a cauda retida pelo runtime, não um histórico ilimitado do terminal. |
| T18 | Landing servida com CSP/headers e assets isolados em `/__landing__/`, sem confundir seus arquivos com os do modelador. | Hospedagem, URL pública e publicação. |
| T22 | Preparação e validação local do pacote Windows, separada da publicação. O pipeline multiplataforma já existia. | Release pública, assinatura T23, instalação/atualização manual nos demais sistemas. |

## Provedores e custos

`NEURONS_OPENAI_COMPATIBLE_BASE_URL` configura um endpoint compatível no servidor, por exemplo um servidor local. O grafo escolhe `provider: "openai-compatible"`; ele não fornece a URL. O perfil compartilhado aplica a política de saída existente também a esse endpoint. Sem chave nomeada, o cliente compatível usa uma credencial fictícia; provedores que exigem autenticação devem receber um segredo cadastrado.

A tabela `PRICE_VERSION = "2026-11-06"` contém preços de texto padrão para GPT-4.1/GPT-4.1 mini e Claude Sonnet/Haiku 4.5, com caches contabilizados segundo cada fornecedor. A inclusão de modelos existentes no catálogo não recomenda seu uso nem garante sua disponibilidade. Modelos sem preço, contagens inválidas e configurações fora da tabela mantêm custo desconhecido. A estimativa não representa uma fatura nem um teto absoluto do provedor; não inclui taxas de ferramentas, batch, residência regional ou outros adicionais. Revalidar a tabela ao atualizar modelos.

Fontes consultadas para os contratos:

- [OpenAI: chamadas de ferramenta](https://developers.openai.com/api/docs/guides/function-calling) e [esforço por modelo](https://developers.openai.com/api/docs/guides/reasoning).
- [Preços GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini) e [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1).
- [Anthropic: preços](https://platform.claude.com/docs/en/about-claude/pricing) e [esforço](https://platform.claude.com/docs/en/build-with-claude/effort).
- [Claude Code: hooks](https://code.claude.com/docs/en/hooks).

## Distribuição

Esta rodada não cria uma tag nem publica artefatos. Antes de uma release pública, escolher a versão, aplicar as migrações da instalação, executar o workflow de release e conferir os instaladores/checksums. Preservar a autorização de migração local descrita em [[Seguranca]].

### Aceitação concluída em 07/11/2026

- Compilação, tipos e lint dos pacotes afetados passaram. Cliente da API regenerado e conferido; auditoria de dependências sem avisos.
- Suítes de interface, desktop, runtimes, protocolo, runner, esquema e provedores aprovadas. A suíte do servidor aprovou 708 casos no lote completo do Codex (710 na revisão independente de 09/11); o teste novo que excedeu o tempo total de inicialização do PGlite foi repetido com sucesso, junto da autorização de webhook, em uma rodada dirigida de 20 casos. Os cinco testes de provedores também foram repetidos após preservar o uso ausente como desconhecido.
- Convites conferidos visualmente em 1280 e 390 pixels, sem transbordamento horizontal; formulário mobile ajustado.
- Quatro instâncias do desktop a partir do código-fonte concluíram o smoke em paralelo. No pacote Windows corrigido, uma execução isolada e quatro simultâneas também passaram: PTY e stream-json simulados, comunicação, escrita de memória, IPC, CSP, fechamento e liberação da trava do banco. As quatro saídas simultâneas do pacote ficaram entre 0,7 e 4,3 segundos, código zero.
- O pacote local é `apps/desktop/release/win-unpacked`, versão de desenvolvimento 0.0.0, sem assinatura; não é um instalador nem uma release pública. Foi gerado com `--config.npmRebuild=false` porque esta máquina não possui Visual Studio Build Tools. Os binários pré-compilados de terminal foram exercitados pelo smoke. A configuração normal de rebuild do CI foi preservada.
- O coletor do empacotador omitia `croner`, necessário ao esquema; o desktop agora o declara explicitamente. O smoke verifica integridade, dependências obrigatórias e compatibilidade de versões do ASAR antes de iniciar. O pacote final teve 17.475 arquivos internos verificados. Compilação e empacotamento devem ocorrer em sequência, sem alterar os arquivos enquanto o pacote é montado.

Continuam separadas: chamadas reais da T04/T07 e dos templates de API, Claude Code real na interface/hybrid, Google real, aceitação de instalação/atualização em macOS/Linux, publicação, assinatura T23 e AWS T26.
