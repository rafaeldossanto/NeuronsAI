# @neurons/desktop

App desktop do NeuronsAI (Electron 45) para Windows, macOS e Linux. O servidor NestJS roda **dentro do processo principal do app** (perfil `local`: o runner dos agentes também é embutido), com o banco PGlite embutido, e a interface do [`@neurons/web`](../web/README.md) abre na janela. Nada para instalar além do app (e do Claude Code CLI, para agentes de terminal reais).

## Como funciona

```
Electron (processo principal)
 ├─ servidor NestJS em 127.0.0.1:<porta livre escolhida pelo sistema>
 │    ├─ /      a interface (apps/web/dist), como app de página única
 │    ├─ /api   a API REST (o prefixo é removido antes de chegar aos controllers)
 │    ├─ /ws    WebSocket dos eventos de execução
 │    └─ runner embutido → Claude Code (PTY ou stream-json), servidor MCP `neurons`
 └─ janela (renderer isolado e sandboxed) → só fala com a origem do servidor
```

- **Pasta de dados e CLI do Claude:** vêm da configuração do servidor ([`apps/server`](../server/README.md): `NEURONS_DATA_DIR`, `NEURONS_CLAUDE_BIN`, ...). Padrão: `%APPDATA%\NeuronsAI`, `~/Library/Application Support/NeuronsAI` ou `~/.local/share/neuronsai`. O banco fica em `<pasta>/db` e os arquivos do próprio Electron em `<pasta>/electron`.
- **Duas travas:** só uma instância do app (`requestSingleInstanceLock`; abrir de novo traz a janela para a frente) e uma trava por arquivo (`<pasta>/db.lock`, com o PID) que impede dois processos de abrirem o mesmo banco, inclusive o servidor avulso. Uma trava deixada por um processo que morreu é retomada sozinha.
- **Segurança:** `contextIsolation`, `sandbox`, sem `nodeIntegration` e sem preload; CSP restritiva (enviada pelo servidor); todo pedido da janela que não vá ao servidor local é cancelado; permissões negadas; `window.open` e navegação para fora são bloqueados (links `http(s)` abrem no navegador do sistema).
- **Menu e atalhos** (`src/menu.ts`) em pt-BR, com a diferença de cada sistema num lugar só. Ferramentas do desenvolvedor só fora do build empacotado.
- O servidor MCP `neurons` (que o Claude Code inicia) roda com o próprio executável do app como Node (`ELECTRON_RUN_AS_NODE=1`).

## Rodar em desenvolvimento

```bash
pnpm install
pnpm --filter @neurons/desktop dev     # compila (inclui web e servidor) e abre o app
```

Com o CLI de mentira (grátis, sem login), como na demo do servidor:

```powershell
$env:NEURONS_DESKTOP_CLAUDE_COMMAND = (Get-Command node).Source
$env:NEURONS_DESKTOP_CLAUDE_ARGS = '["packages/agent-runtimes/test-fixtures/fake-claude.mjs"]'   # caminho absoluto
pnpm --filter @neurons/desktop start
```

Teste de aceitação (abre o app de verdade com pasta de dados temporária, publica `two-terminals.json`, roda e confere que a execução termina e que a trava é liberada ao sair):

```bash
pnpm --filter @neurons/desktop smoke                          # do código-fonte
pnpm --filter @neurons/desktop smoke -- <caminho do NeuronsAI.exe/NeuronsAI>   # do app empacotado
```

## Gerar o build `--dir`

```bash
pnpm --filter @neurons/desktop build        # web, servidor e app
pnpm --filter @neurons/desktop dist:dir     # release/<sistema>-unpacked/ (sem instalador)
```

O `electron-builder` recompila o `node-pty` para o Electron (`@electron/rebuild`). No Windows isso exige o node-gyp achar o Visual Studio Build Tools; se ele não achar (o node-gyp 12 ainda não reconhece o Visual Studio 2026), o binário que já vem no pacote basta (é N-API, serve a qualquer versão do Electron): `pnpm --filter @neurons/desktop dist:dir -- --config.npmRebuild=false`. O CI roda `dist:dir` nos três sistemas.

Instaladores, release e atualização automática são a T22; assinatura de código, a T23. O app ainda não está assinado (`asar` desligado por ora: o Claude Code e o `node-pty` leem arquivos do disco).

## Variáveis de ambiente

Além das `NEURONS_*` do servidor (o app fixa o perfil `local`, o endereço `127.0.0.1` e a porta). Estas só servem a testes e demos (`.env.example`):

| Variável                         | Descrição                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `NEURONS_DESKTOP_CLAUDE_COMMAND` | Programa que roda no lugar do Claude Code CLI (o de mentira). Vazio: procura o CLI real. |
| `NEURONS_DESKTOP_CLAUDE_ARGS`    | Lista JSON dos argumentos que vêm antes dos do CLI. Só vale com a variável acima.        |

Só `src/config.ts` lê o ambiente (exceção no lint, como `packages/runner/src/config.ts`).

## Ícone

`build/icon.png` é provisório (neurônio âmbar `#E9A15C` sobre grafite), gerado por `pnpm --filter @neurons/desktop icon`. O definitivo substitui o arquivo; o `electron-builder` deriva `.ico` e `.icns` dele.
