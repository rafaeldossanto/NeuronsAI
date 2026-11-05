# Templates da T17

O catálogo contém três receitas completas, sem valores de credenciais ou caminhos da máquina. Os arquivos JSON são a fonte de dados. O módulo JavaScript com declaração de tipos é reexportado pelo pacote; fica fora de `src` para manter o escopo e a configuração de build do pacote inalterados.

- `sales-followup`: Venda → pós-venda, webhook, Vendedor e PosVenda por API Anthropic, consulta HTTP de pedido. Criar os segredos ANTHROPIC_API_KEY e ORDERS_API_TOKEN e substituir o domínio reservado `orders.example.invalid` antes de executar. `secretName` é o nome do segredo; o cabeçalho usa `{{secret:ORDERS_API_TOKEN}}`, nunca o valor.
- `research-review`: Pesquisa com revisor, dois terminais Claude Code com Haiku 5.5, gatilho manual, `ask` e `reply` autorizados nos dois sentidos. O Pesquisador chama `finish`.
- `api-cli-team`: Principal por API Sonnet 5.5, Executor e Revisor por Claude Code. Exige o segredo ANTHROPIC_API_KEY e a assinatura conectada na CLI dos terminais.

Modelos conferidos na [documentação oficial da Anthropic](https://platform.claude.com/docs/en/models/overview). Todos os agentes têm orçamento e tempo ocioso; todas as ligações têm limite de mensagens. Custo desconhecido de API não vira um teto garantido em USD: validação de consumo real permanece pendente da T07.

## API do catálogo

`listTemplates()` devolve cópias tipadas; `getTemplate(id)` devolve a receita ou undefined; `instantiateTemplate(id, { projectId, cwd?, name? })` monta uma cópia independente. IDs das fixtures são recusados como id do novo projeto.

Por decisão do Rafael, a tela pede a pasta antes de criar templates com terminais. A receita portátil usa `cwd: "."`; esse marcador não é um grafo executável. A instância recebe a pasta absoluta informada pelo usuário, então passa em `validateGraph` e `migrateGraph` sem mudanças. Isso preserva a regra atual do contrato sem incluir caminhos privados no catálogo. Use a instância, não o marcador portátil, para salvar/publicar/executar.

## Aceitação gratuita

Após o build dos pacotes, na raiz:

```powershell
node packages/graph-schema/templates/verify-fake-cli.mjs
```

O script cria servidor e banco temporários, instancia e reabre os três templates, publica cada um explicitamente e roda apenas Pesquisa com revisor. O Claude Code é sempre substituído por `packages/agent-runtimes/test-fixtures/fake-claude.mjs`; não existe opção para contas reais. Confere pergunta, resposta e resultado, depois encerra o servidor e remove somente sua pasta temporária.

Os templates de API não são executados. Chamadas reais, chaves e validação paga continuam pendentes da T07. Criar pela interface também não publica, ativa gatilho nem inicia execução automaticamente.

Validação local em 2026-11-04: os três grafos foram criados, reabertos e publicados explicitamente no banco temporário. Pesquisa com revisor terminou com sucesso e registrou pergunta e resposta nos dois sentidos. As instâncias configuradas passaram no esquema e na migração. As chamadas reais dos templates de API continuam pendentes da T07.
