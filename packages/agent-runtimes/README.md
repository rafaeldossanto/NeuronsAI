# @neurons/agent-runtimes

O contrato entre o Hub e os runtimes de agente (T06) e os runtimes de terminal do Claude Code (T08).
**Sem NestJS e sem banco**: só depende de `@neurons/graph-schema` e de `@neurons/mcp-neurons`, para que um
runner separado (T24) possa hospedar os mesmos runtimes.

Dois pontos de entrada:

| Import                           | O que traz                                                                                                                                                                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@neurons/agent-runtimes`        | O contrato, leve e sem dependências nativas: `AgentRuntime`, `AgentRuntimeState`, `InboundMessage`, `AgentCommunication` (`sendMessage`, `ask`, `reply`, `listPeers`, `finish`, `reportUsage`), `AgentRuntimeFactory`, `TerminalAgentRuntime`, `AgentUsage`, `Signal`. |
| `@neurons/agent-runtimes/claude` | Os runtimes e a `TerminalRuntimeFactory` (carrega `node-pty` e `@xterm/headless`).                                                                                                                                                                                     |

## Runtimes

`TerminalRuntimeFactory` escolhe pelo `runtime` do agente: `kind: "terminal"` e `cli: "claude"`; `mode: "pty"` (padrão) ou
`"stream-json"`. Outra `cli` (`codex`, `gemini`, `custom`) falha com mensagem clara; fica para depois.

- **`ClaudeTerminalRuntime` (PTY).** `node-pty` + `@xterm/headless` (a tela renderizada). O usuário vê e digita na CLI de verdade.
  - _Fim de turno:_ hook `Stop`. O rodapé (`? for shortcuts` livre / `esc to interrupt` ocupado) e o silêncio só confirmam, ou
    substituem o hook se ele nunca chegar (`hookGraceMs`).
  - _Injeção:_ digita o texto (multilinha vai em _bracketed paste_), espera o eco, 400 ms, Enter; o hook `UserPromptSubmit` confirma
    (reenvia o Enter até 3 vezes).
  - _Saída:_ `onOutput` entrega os bytes brutos (evento efêmero, nunca vai para `run_events`); `outputSnapshot()` guarda os últimos
    ~200 KB para quem conectar depois; `writeInput(data)` digita no terminal. Um prompt que o usuário digita na própria tela vira um turno
    normal (`ocupado` → `ocioso`).
  - _Diálogos da 1ª execução_ (tema, notas de segurança, extensão do Chrome) são confirmados sozinhos; **confiar na pasta nunca**: o
    boot espera o usuário responder no terminal e, passado `userDialogTimeoutMs`, falha dizendo o que fazer. Pedido de login falha com
    mensagem em português.
- **`ClaudeStreamJsonRuntime`.** `claude -p --input-format stream-json --output-format stream-json`, uma sessão persistente. A mensagem é
  uma linha JSON no stdin; o evento `result` é o fim do turno e traz uso e custo, repassados por `communication.reportUsage` (o servidor
  grava `UsageRecorded`) antes de o agente voltar a `idle`. Sem tela; sem permissões interativas (`--permission-prompts none`).

## Como a CLI é configurada sem tocar na pasta do usuário

Nada é escrito em `~/.claude` nem na pasta do projeto. Cada sessão cria uma pasta temporária **só do usuário** (POSIX `0700`/`0600`;
Windows: ACL reduzida com `icacls`) e a apaga no `stop()`:

- `settings.json` → `--settings <arquivo>`: hooks **HTTP** `UserPromptSubmit` e `Stop` apontando para a ponte local (o Claude Code não aceita hook HTTP em `SessionStart`; a prontidão vem do rodapé da tela).
- `mcp-config.json` → `--mcp-config <arquivo> --strict-mcp-config`: o servidor MCP `neurons` (`@neurons/mcp-neurons`), com o
  endereço e o token da ponte no `env` dele, e `timeout` = timeout do `ask` do Hub + 30 s.
- `briefing.md` → `--append-system-prompt-file`.
- `--setting-sources project,local`: as configurações do usuário (`~/.claude/settings.json`) não entram; as do projeto, sim.
- `--allowedTools mcp__neurons__send_message,…` (só as 5 ferramentas do Hub). Nunca `--dangerously-skip-permissions`; os `args` do grafo
  são repassados, menos os que desfazem esse arranjo ou ligam o bypass (a fábrica recusa antes de iniciar).
- Modelo e demais ajustes: pelos `args` do agente (`["--model", "haiku"]`). O esforço do agente vira `--effort` se `claude --help` o listar;
  senão é ignorado com um aviso no log.
- `MCP_TOOL_TIMEOUT` no ambiente da CLI também fica acima do timeout do `ask`, para o `ask` nunca ser cortado antes do Hub.

## Ponte local

Cada runtime sobe um servidor HTTP em `127.0.0.1` (porta aleatória) com um **token aleatório por agente e por execução**. Ele recebe as
chamadas do `mcp-neurons` (`/tools/*`) e os avisos dos hooks (`/hooks/*`), recusa tudo que não traz `Authorization: Bearer <token>` (401)
e repassa ao `AgentCommunication`. O token só existe nos arquivos temporários e na memória; nunca é logado nem publicado em evento.
O protocolo (rotas e formatos) está em `@neurons/mcp-neurons` (`protocol.ts`), importado pelos dois lados.

## Ambiente da CLI

A CLI **não herda o `process.env`** do servidor. Só passa o mínimo de sistema (`platform/child-env.ts`), mais `TERM`, `MCP_TOOL_TIMEOUT`:

- Todos os sistemas: `PATH`, `TEMP`, `TMP`, `TMPDIR`, `LANG`, `LC_ALL`, `LC_CTYPE`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`,
  `SSL_CERT_FILE`, `SSL_CERT_DIR`, `NODE_EXTRA_CA_CERTS`, `CLAUDE_CONFIG_DIR`.
- Windows: `SystemRoot`, `SystemDrive`, `windir`, `ComSpec`, `PATHEXT`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`,
  `ProgramData`, `ProgramFiles`, `ProgramFiles(x86)`, `ProgramW6432`, `USERNAME`, `USERDOMAIN`, `OS`, `PROCESSOR_ARCHITECTURE`.
- macOS/Linux: `HOME`, `USER`, `LOGNAME`, `SHELL`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_RUNTIME_DIR`.

Segredos e variáveis `CLAUDE_CODE_*`/`ANTHROPIC_*` do processo hospedeiro ficam de fora. O único lugar do pacote que lê `process.env`
é `platform/host-environment.ts`.

## Por sistema operacional (`src/platform`)

- `claude-binary.ts`: `NEURONS_CLAUDE_BIN` → `claude` no `PATH` → `~/.local/bin`, `~/.claude/local` (e `/usr/local/bin`, `/opt/homebrew/bin`) → a CLI
  embutida no app desktop (Windows: `…\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code\<versão>\<hash>\claude.exe`; macOS:
  `~/Library/Application Support/Claude/claude-code`), pasta de versão mais nova.
- `claude-cli.ts` (em `claude/`): `claude auth status` antes de subir; sem login, falha pedindo `claude auth login`.
- `process-tree.ts`: Windows `taskkill /T /F`; macOS/Linux, grupo de processos (SIGTERM e, se preciso, SIGKILL).
- `child-env.ts`, `private-directory.ts`.

## Testes

`pnpm test` roda com uma **CLI falsa** (`test-fixtures/fake-claude.mjs`, um script Node que imprime o rodapé, chama os hooks por HTTP, lê a
entrada e chama o `mcp-neurons` de verdade) e não gasta nada. O teste com a CLI real é o `test:e2e:claude` do `@neurons/server`.

`node-pty` 1.1.0 traz binário pronto para Windows e macOS (no Linux ele compila no `postinstall`; por isso está em `allowBuilds`).
