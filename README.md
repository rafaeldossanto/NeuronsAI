# NeuronsAI

[![CI](https://github.com/rafaeldossanto/NeuronsAI/actions/workflows/ci.yml/badge.svg)](https://github.com/rafaeldossanto/NeuronsAI/actions/workflows/ci.yml)

Orquestrador visual de agentes de IA, escrito em TypeScript de ponta a ponta (NestJS no servidor, React no web).

## Pré-requisitos

- Node 24 ou superior
- Corepack (já vem com o Node), que fornece o pnpm na versão fixada em `packageManager`
- Rode **uma única vez** `corepack enable` num terminal aberto como administrador. Sem isso o Turbo não encontra o `pnpm` no PATH

## Como rodar

```bash
pnpm install --frozen-lockfile
pnpm turbo lint typecheck test build
pnpm api:check
```

## Estrutura

```
apps/
  server/        API NestJS, Hub, contas, memórias, gatilhos e runtimes de API
  web/           Modelador React, execução ao vivo, histórico e painéis
  desktop/       App Electron, servidor/runner local, PGlite e conexão remota
  site/          Landing, downloads e instruções de instalação
packages/
  graph-schema/  Schemas do grafo (zod)
  providers/     Provedores de modelos, capacidades e estimativa de custo
  agent-runtimes/  Contratos de agente e runtimes do Claude Code
  tools/         Ferramentas MCP, HTTP e Obsidian com leitura/escrita autorizada
  mcp-neurons/   Servidor MCP dos neurônios
  runner-protocol/  Protocolo (zod) entre o servidor e os runners
  runner/        Runner: hospeda os agentes de terminal e conecta ao servidor
  api-client/    Cliente tipado da API (gerado do OpenAPI do servidor)
Docs/            Cofre Obsidian com a documentação do projeto
```

O código das aplicações é organizado por domínio: contas, grafos, execuções,
memórias, runners e demais responsabilidades. O [mapa da estrutura e as convenções](Docs/Estrutura%20do%20projeto.md)
detalha onde colocar páginas, serviços, consultas, componentes e testes.

## Documentação

- [Visão geral](Docs/NeuronsAI.md)
- [Estrutura por domínio](Docs/Estrutura%20do%20projeto.md)
- [Plano de Implementação e estado consolidado](Docs/Plano/Plano%20de%20Implementação.md#estado-consolidado)
- [Contas e Google](Docs/Plano/T25%20-%20Google%20e%20recursos%20por%20organizacao.md)
- [Desktop remoto](Docs/Plano/T25%20-%20Desktop%20remoto.md)
- [Correções de segurança e atualização da instalação](Docs/Seguranca.md)
- Como rodar: [servidor](apps/server/README.md), [web](apps/web/README.md), [desktop](apps/desktop/README.md) e [site](apps/site/README.md).

## Estado atual — 2026-11-07

Editor, anotações, execução ao vivo, replay, templates, ferramentas/memórias, runners,
contas por organização e desktop foram integrados. O CI do commit `25733af` passou nas
checagens e no empacotamento dos três sistemas, integração Postgres e gitleaks.

Provedores OpenAI, Anthropic e APIs compatíveis já usam a abstração de sessões, com
estimativas de custo para o catálogo conhecido. Veja a [entrega local sem custo](Docs/Plano/Entrega%20local%20sem%20custo.md).
Permanecem pendentes a aceitação com Google/modelos reais, a primeira release pública e a publicação da landing.
WhatsApp, AWS e assinatura de código estão nas etapas restantes do plano. O terminal
executa Claude Code; Codex/Gemini/custom ainda não têm adaptadores. A conexão remota do
desktop abre a interface do servidor, mas o runner separado precisa ser iniciado à parte.

As instruções de distribuição descrevem os pipelines disponíveis; não indicam que já
existe release publicada. Implementação, aceitação real e publicação são acompanhadas
separadamente no plano.

## Segredos e variáveis de ambiente

- Só os pontos de configuração autorizados leem `process.env`; no servidor, ficam em `apps/server/src/shared/config`. O ESLint restringe esse acesso nos demais módulos.
- Nenhum segredo com valor padrão em código, teste, fixture ou `.env.example`.
- Nunca registre em log um valor sensível.
- Arquivos `.env*` ficam fora do git (exceto `.env.example`, sem valores reais).
- Segredos do CI só via `secrets.*` do GitHub Actions; o job `secrets` roda o gitleaks nos pushes para main/dev e nos PRs.
- Na implantação AWS planejada (T26), os segredos ficarão no Secrets Manager.
