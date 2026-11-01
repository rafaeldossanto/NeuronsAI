# NeuronsAI

[![CI](https://github.com/rafaeldossanto/NeuronsAI/actions/workflows/ci.yml/badge.svg)](https://github.com/rafaeldossanto/NeuronsAI/actions/workflows/ci.yml)

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

## Segredos e vari�veis de ambiente

- S� o m�dulo de config (`apps/server/src/shared/config`) l� `process.env`; o ESLint barra o acesso em qualquer outro lugar.
- Nenhum segredo com valor padr�o em c�digo, teste, fixture ou `.env.example`.
- Nunca registre em log um valor sens�vel.
- Arquivos `.env*` ficam fora do git (exceto `.env.example`, sem valores reais).
- Segredos do CI s� via `secrets.*` do GitHub Actions; o job `secrets` roda o gitleaks em todo push e PR.
- Na AWS, os segredos ficam no Secrets Manager.
