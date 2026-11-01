# NeuronsAI

Orquestrador visual de agentes de IA, escrito em TypeScript de ponta a ponta (NestJS no servidor, React no web).

## Pré-requisitos

- Node 24 ou superior
- Corepack (já vem com o Node), que fornece o pnpm na versão fixada em `packageManager`
- Rode **uma única vez** `corepack enable` num terminal aberto como administrador. Sem isso o Turbo não encontra o `pnpm` no PATH

## Como rodar

```bash
pnpm install
pnpm turbo lint typecheck test build
```

## Estrutura

```
apps/
  server/        API (NestJS, a partir da T03)
  web/           Interface (Vite + React, a partir da T11)
  site/          Site institucional
packages/
  graph-schema/  Schemas do grafo (zod)
  providers/     Provedores de modelos de IA
  mcp-neurons/   Servidor MCP dos neurônios
Docs/            Cofre Obsidian com a documentação do projeto
```

## Documentação

- [Visão geral](Docs/NeuronsAI.md)
- [Plano de Implementação](Docs/Plano/Plano%20de%20Implementação.md)
