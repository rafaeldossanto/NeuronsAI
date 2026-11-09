# Regras para quem trabalha no NeuronsAI

Vale para o Codex, o Claude Code e qualquer outro agente. O repositório é **público**. Fale com o Rafael em pt-BR.

## Branches e entrega

- Toda mudança vai para a `dev` por uma branch própria: `codex/<tarefa>` ou `claude/<tarefa>`.
- **Nunca trabalhe direto na `dev` da pasta principal.** Use uma branch, de preferência numa worktree própria.
- A `main` só recebe PR vindo da `dev`, com **merge commit, nunca squash**. Nunca dê push direto na `main`, nunca use `--force`.
- Nada de tag, release ou publicação sem o Rafael pedir.
- Ao terminar cada entrega, no mesmo dia: commit e push da branch. Trabalho sem commit não conta como entregue.

## Antes de entregar

Rode e diga no relatório o que rodou e o que não rodou:

```bash
pnpm format:check
pnpm turbo run lint typecheck test build
pnpm api:check
pnpm --filter @neurons/server test:integration   # se mexeu no servidor (precisa do Docker)
pnpm --filter @neurons/desktop smoke             # se mexeu no desktop
```

Se der `ENOTEMPTY` no cache do vitest, rode o turbo com `--concurrency=2`.

## Segredos

Nenhum segredo em código, teste, fixture, log, evento ou resposta da API. Chaves só pelo cofre de segredos do servidor. O gitleaks do CI roda depois do push, então confira antes.

## Variáveis de ambiente

- `process.env` só nos módulos de config: `apps/server/src/shared/config/`, `apps/desktop/src/config.ts`, `packages/runner/src/config.ts`, `packages/mcp-neurons/src/config.ts` e `packages/agent-runtimes/src/platform/host-environment.ts` (o lint barra o resto).
- `import.meta.env` só em `apps/web/src/config.ts` (convenção; o lint não pega).
- Variável nova entra no `.env.example` (`apps/server/` ou `apps/desktop/`) e no README do pacote.

## Dependências

- Versão exata, sem `^` nem `~` (a exceção antiga é `@types/node`).
- Duas branches paralelas não adicionam dependência ao mesmo tempo: o `pnpm-lock.yaml` conflita.

## Idioma

Código e identificadores em inglês. Textos de tela, documentação e commits em pt-BR, no estilo de `git log --oneline -15`.

## Custo e rede

- Nenhuma chamada paga, chave real de API, AWS ou assinatura de código sem autorização explícita do Rafael.
- O servidor escuta só em `127.0.0.1` por padrão; sair disso exige `NEURONS_ALLOW_REMOTE=true`.

## Onde olhar

- `Docs/NeuronsAI.md`: decisões de produto e arquitetura.
- `Docs/Plano/Plano de Implementação.md`: andamento por tarefa.
- `Docs/Estrutura do projeto.md`: onde cada coisa mora (web e desktop são organizados por domínio).
- `Docs/Seguranca.md`: proteções aplicadas e como atualizar uma instalação.
