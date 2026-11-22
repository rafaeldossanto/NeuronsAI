# @neurons/agent-runtimes

O contrato entre o Hub e os runtimes de agente (T06) e os runtimes de terminal do Claude Code (T08) e do Codex CLI (conta do ChatGPT).
**Sem NestJS e sem banco**: só depende de `@neurons/graph-schema` e de `@neurons/mcp-neurons`, para que um
runner separado (T24) possa hospedar os mesmos runtimes.

Dois pontos de entrada:

| Import                           | O que traz                                                                                                                                                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@neurons/agent-runtimes`        | O contrato, leve e sem dependências nativas: `AgentRuntime`, `AgentRuntimeState`, `InboundMessage`, `AgentCommunication` (`sendMessage`, `ask`, `reply`, `listPeers`, `finish`, `reportUsage`, `reportToolCall`), `AgentRuntimeFactory`, `TerminalAgentRuntime`, `AgentUsage`, `Signal`. |
| `@neurons/agent-runtimes/claude` | Os runtimes e a `TerminalRuntimeFactory` (carrega `node-pty` e `@xterm/headless`).                                                                                                                                                                                                       |

## Runtimes

`TerminalRuntimeFactory` escolhe pelo `runtime` do agente: `kind: "terminal"` e `cli: "claude"` ou `"codex"`; `mode: "pty"` (padrão) ou
`"stream-json"`. Outra `cli` (`gemini`, `custom`) falha com mensagem clara; fica para depois. A parte comum dos dois (estado, ponte local, arquivos temporários, desligamento sem processo órfão) mora em `cli/cli-runtime-base.ts`; `claude/` e `codex/` só sabem a própria CLI.

- **`ClaudeTerminalRuntime` (PTY).** `node-pty` + `@xterm/headless` (a tela renderizada). O usuário vê e digita na CLI de verdade.
  - _Fim de turno:_ hook `Stop`. O rodapé (`? for shortcuts` livre / `esc to interrupt` ocupado) e o silêncio só confirmam, ou
    substituem o hook se ele nunca chegar (`hookGraceMs`).
  - _Injeção:_ digita o texto (multilinha vai em _bracketed paste_), espera o eco, 400 ms, Enter; o hook `UserPromptSubmit` confirma
    (reenvia o Enter até 3 vezes).
  - _Saída:_ `onOutput` entrega os bytes brutos (evento efêmero, nunca vai para `run_events`); `outputSnapshot()` guarda os últimos
    ~200 KB para quem conectar depois; `writeInput(data)` digita no terminal. Um prompt que o usuário digita na própria tela vira um turno
    normal (`ocupado` → `ocioso`).
  - _Tamanho:_ abre em 120×40 (`DEFAULT_TERMINAL_SIZE`). `resize(cols, rows)` redimensiona o PTY (o programa recebe o `SIGWINCH` e repinta) e a tela `@xterm/headless` que o runtime lê, **recomeça o buffer do `outputSnapshot()`** (o que foi impresso para o tamanho antigo sairia embaralhado no novo; `size` é o tamanho em que o snapshot foi impresso) e avisa `onResize`, antes de qualquer saída desenhada para o novo tamanho. O mesmo tamanho, um tamanho que não seja inteiro positivo ou uma sessão já encerrada não fazem nada; pedido antes de subir vale quando subir. Quem decide o tamanho entre vários clientes é o servidor (`apps/server/README.md`, "Tamanho do terminal").
  - _Diálogos da 1ª execução_ (tema, notas de segurança, extensão do Chrome) são confirmados sozinhos; **confiar na pasta nunca**: o
    boot espera o usuário responder no terminal e, passado `userDialogTimeoutMs`, falha dizendo o que fazer. Pedido de login falha com
    mensagem em português.
- **`ClaudeStreamJsonRuntime`.** `claude -p --input-format stream-json --output-format stream-json`, uma sessão persistente. A mensagem é
  uma linha JSON no stdin; o evento `result` é o fim do turno e traz uso e custo, repassados por `communication.reportUsage` (o servidor
  grava `UsageRecorded`) antes de o agente voltar a `idle`. Sem tela; sem permissões interativas (`--permission-prompts none`).
  - _Texto ao vivo:_ roda com `--include-partial-messages`; os eventos `stream_event` (eventos brutos da API: `content_block_delta` com `text_delta` e `input_json_delta`) viram `onOutputDelta` (`StreamingAgentRuntime`): o texto livre no canal `text` e o campo `text`/`question` das chamadas `send_message`/`reply`/`ask` no canal `message` (`JsonStringFieldStream` lê o JSON parcial). Agrupado a cada ~50 ms (`OutputBatcher`), só ao vivo, nunca no log. O parser é tolerante: evento que não reconhece é ignorado. Formato conferido na documentação da CLI; falta confirmar numa rodada real.

**O custo é por turno (T24).** O `total_cost_usd` de cada `result` do stream-json é o custo da _sessão inteira até ali_, não do turno (medido com o Claude Code 2.1.309: totais de 0,00099, 0,00155 e 0,00200 em três turnos, o do meio com 4 tokens de saída; `modelUsage` também soma os turnos, só `usage` é por turno). O runtime guarda o total anterior e reporta a diferença (`costOfTurn`), então o `UsageRecorded` de cada turno traz o custo daquele turno e a soma dos turnos fecha com o total.

**Custo e descarga do uso (T10).** `AgentRuntime.reportsCost` diz se o runtime informa o que cada turno custou: o stream-json sim, o
PTY não (a tela não traz o uso). Quem aplica orçamento precisa saber disso para não tratar "sem custo" como zero. Como o `finish`
chega no meio de um turno e o `result` só vem depois, `stop()` do stream-json espera o turno em andamento terminar por até
`usageFlushMs` (padrão `DEFAULT_USAGE_FLUSH_MS`, 4 s) antes de matar a CLI, e só então derruba o processo. No Windows o `stop()` também
solta o pipe e a thread que o node-pty deixa abertos (sem isso o processo do servidor não termina depois de parar um terminal).

## Codex CLI (conta do ChatGPT)

`cli: "codex"` roda o **Codex CLI oficial** da OpenAI, que o usuário instala (`npm i -g @openai/codex`) e loga com a própria conta (`codex login`, "Sign in with ChatGPT"). Mesma regra da decisão D5: o NeuronsAI só executa o binário original; **nunca lê, copia nem guarda** o `~/.codex/auth.json` ou tokens, e não passa requisições pela assinatura. O login é consultado pelo comando oficial `codex login status` (exit 0 = logado), nunca pelo arquivo. `CodexCli` acha o binário (`NEURONS_CODEX_BIN` → PATH → pasta do `npm -g`, `~/.local/bin`, Homebrew), informa o login e devolve o comando de login.

> **Origem das informações.** Nenhuma rodada real do `codex` foi feita: as flags, os eventos do `exec --json`, o `login status` e a configuração do MCP vêm da documentação oficial (developers.openai.com/codex, `codex-rs/exec/src/exec_events.rs` no GitHub) e os testes usam uma CLI falsa (`test-fixtures/fake-codex.mjs`). O que só a documentação garante está marcado abaixo como _(docs)_; a aceitação real é do Rafael.

- **`CodexExecRuntime` (`mode: "stream-json"`).** Um `codex exec --json` por mensagem; a seguinte retoma a sessão da primeira (`codex exec … resume <thread_id> -`, com o `thread_id` do evento `thread.started`). A mensagem entra pelo stdin (`-`), sem limite de tamanho nem aspas. O `turn.completed` é o fim do turno e traz os tokens (`input_tokens` inclui os `cached_input_tokens`: o runtime reporta os não-cacheados como entrada e os cacheados como `cacheReadTokens`); custo em USD não vem, então `reportsCost = false`. `turn.failed` (cota esgotada, erro do modelo) derruba o agente com a mensagem da CLI; o evento `error` avulso só é lembrado (a CLI o usa também para "Reconnecting…"). _(docs)_ O `exec --json` só entrega itens inteiros (`item.completed` com `agent_message`), **sem tokens do texto**: o `onOutputDelta` recebe cada mensagem quando o modelo termina de escrevê-la e o corpo de `send_message`/`reply`/`ask` assim que a chamada começa, não letra por letra. Chamadas de ferramenta da CLI (`command_execution`, `file_change`, `web_search`, MCP de terceiros) viram `ToolCalled` sem argumentos.
- **Por que `exec --json` e não o `codex app-server`.** O `app-server` (JSON-RPC) tem `item/agentMessage/delta` e daria token por token, mas a própria documentação o marca em parte como experimental (métodos que exigem `experimentalApi`, WebSocket "unsupported") e traz pedidos de aprovação do servidor para o cliente; sem rodar a CLI real, escrever esse cliente seria chute. O `exec --json` é o contrato estável e documentado. Trocar depois é só trocar o leaf; a base e o resto não mudam.
- **`CodexTerminalRuntime` (`mode: "pty"`).** O TUI do `codex` num pseudo-terminal, como o do Claude. Fim de turno: o programa do `notify` do Codex (_docs_: roda em `agent-turn-complete` com um JSON no último argumento) é um script Node numa pasta privada da sessão que avisa a rota `stop` da ponte local; a linha de status `esc to interrupt` na tela confirma que a mensagem foi aceita e, junto do silêncio e sem pedido de aprovação na tela, substitui o aviso se ele nunca chegar. O boot espera a tela quieta; **confiar na pasta nunca é respondido** (só com `trustWorkingDirectory`), a tela de login vira o erro "rode `codex login`". Os padrões de tela (`esc to interrupt`, "trust the contents", "Sign in with ChatGPT") vêm da documentação e da memória do TUI, não de uma rodada real.
- **Servidor MCP `neurons` e instruções, sem tocar em `~/.codex`.** Entram por `-c` desta execução: `mcp_servers.neurons.command/args/env`, `required=true` (sem as ferramentas o agente não conversa: melhor falhar), `startup_timeout_sec`, `tool_timeout_sec` (= timeout do `ask` + 30 s), `default_tools_approval_mode="approve"` (_docs_: aprova só as ferramentas desse servidor) e `developer_instructions` (o briefing; limite de 16 000 caracteres pela linha de comando). **O endereço e o token da ponte nunca vão na linha de comando**: vão no ambiente da CLI e o MCP os recebe por `env_vars` (encaminha as variáveis pelo nome). Limite conhecido: o Codex não tem `--strict-mcp-config`, então servidores MCP que o usuário configurou no `~/.codex/config.toml` continuam carregando.
- **Sandbox e aprovação: no máximo o que o agente Claude tem.** O Claude roda em `--permission-mode manual` com só as 7 ferramentas `neurons` pré-aprovadas (leitura livre; escrever e rodar comando precisam de uma pessoa, e no stream-json nada disso pode ser respondido, então é negado). O equivalente documentado do Codex: `--sandbox read-only`; no PTY `--ask-for-approval on-request` (a pessoa responde no terminal, como no Claude); no `exec`, que não tem a quem perguntar, `approval_policy="never"` (o que o sandbox não permite falha). Os `args` do agente só podem trocar para `--sandbox workspace-write` (par do `acceptEdits` do Claude), `--model` e flags inofensivas; são recusados `--yolo`, `--dangerously-bypass-approvals-and-sandbox`, `--full-auto`, `--approve-for-me`, `--sandbox danger-full-access`, `-c/--config`, `--profile`, `--cd`, `--add-dir`, `--ask-for-approval`, `--json`, `--search`, `--remote` e outros (`codex-args.ts`).
- **Modelo e esforço.** `runtime.model` vira `--model` (vazio: o padrão da conta); o esforço vira `model_reasoning_effort` (`xhigh`/`max` ficam em `high`, que todo modelo tem).
- **Acesso.** `subscription` é o caso principal (a CLI recusa começar se o login for por chave de API, para não gastar a cota errada). `api-key` só no `stream-json`: a chave vai no ambiente do processo filho como `CODEX_API_KEY` (_docs_: aceita no `codex exec`), sem gravar em disco; no PTY a CLI exigiria `codex login --with-api-key`, que grava o `auth.json`, então a fábrica recusa com mensagem clara.
- **Windows.** O `npm i -g` deixa um atalho `codex.cmd`, que o Node não executa sem shell (e o shell estraga as aspas dos `-c`); o runtime troca o atalho por `node …/@openai/codex/bin/codex.js` (o `bin` do pacote), ou usa o `codex.exe` que `NEURONS_CODEX_BIN` apontar.
- Ambiente: além do mínimo do Claude, o filho herda `CODEX_HOME` (onde o `codex login` guarda o login, se o usuário o mudou). `OPENAI_API_KEY` e outros segredos do hospedeiro continuam de fora.

## Como a CLI é configurada sem tocar na pasta do usuário

Nada é escrito em `~/.claude` nem na pasta do projeto. Cada sessão cria uma pasta temporária **só do usuário** (POSIX `0700`/`0600`;
Windows: ACL reduzida com `icacls`) e a apaga no `stop()`:

- `settings.json` → `--settings <arquivo>`: hooks **HTTP** `UserPromptSubmit` e `Stop` apontando para a ponte local (o Claude Code não aceita hook HTTP em `SessionStart`; a prontidão vem do rodapé da tela).
- `mcp-config.json` → `--mcp-config <arquivo> --strict-mcp-config`: o servidor MCP `neurons` (`@neurons/mcp-neurons`), com o
  endereço e o token da ponte no `env` dele, e `timeout` = timeout do `ask` do Hub + 30 s.
- `briefing.md` → `--append-system-prompt-file`.
- `--setting-sources project,local`: as configurações do usuário (`~/.claude/settings.json`) não entram; as do projeto, sim.
- `--allowedTools mcp__neurons__send_message,…` (as 7 ferramentas do MCP `neurons`: comunicação, `list_tools` e `use_tool`). Nunca `--dangerously-skip-permissions`; os `args` do grafo
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
  `SSL_CERT_FILE`, `SSL_CERT_DIR`, `NODE_EXTRA_CA_CERTS`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`.
- Windows: `SystemRoot`, `SystemDrive`, `windir`, `ComSpec`, `PATHEXT`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`,
  `ProgramData`, `ProgramFiles`, `ProgramFiles(x86)`, `ProgramW6432`, `USERNAME`, `USERDOMAIN`, `OS`, `PROCESSOR_ARCHITECTURE`.
- macOS/Linux: `HOME`, `USER`, `LOGNAME`, `SHELL`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_RUNTIME_DIR`.

Segredos e variáveis `CLAUDE_CODE_*`/`ANTHROPIC_*` do processo hospedeiro ficam de fora. O único lugar do pacote que lê `process.env`
é `platform/host-environment.ts`.

## Por sistema operacional (`src/platform`)

- `claude-binary.ts`: `NEURONS_CLAUDE_BIN` → `claude` no `PATH` → `~/.local/bin`, `~/.claude/local` (e `/usr/local/bin`, `/opt/homebrew/bin`) → a CLI
  embutida no app desktop (Windows: `…\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code\<versão>\<hash>\claude.exe`; macOS:
  `~/Library/Application Support/Claude/claude-code`), pasta de versão mais nova. No Windows entra também `%LOCALAPPDATA%Claude-Data<família do pacote>claude-code` (onde as versões novas do app guardam a CLI; achado na aceitação real de 11/11/2026), e vale a versão mais nova entre todas as pastas.
- `claude-cli.ts` (em `claude/`): `claude auth status` antes de subir; sem login, falha pedindo `claude auth login`.
- `codex-binary.ts` e `codex-cli.ts` (em `codex/`): `NEURONS_CODEX_BIN` → `codex` no `PATH` → `%APPDATA%\npm`, `~/.local/bin`, `~/.npm-global/bin`, `/usr/local/bin`, `/opt/homebrew/bin` → (só no Windows, por último) a cópia do app do Codex em `<CODEX_HOME>\.sandbox-bin\codex.exe` (`CODEX_HOME` ou `~\.codex`; só o nome exato `codex.exe`, nunca o `codex-command-runner-*.exe` nem a pasta `WindowsApps`, de onde o Windows nega a execução). Essa pasta é interna do app: a versão pode ser alfa ou ficar para trás, e `NEURONS_CODEX_BIN` ou o CLI do npm têm prioridade; `codex login status` antes de subir; sem login, falha pedindo `codex login`.
- `process-tree.ts`: Windows `taskkill /T /F`; macOS/Linux, grupo de processos (SIGTERM e, se preciso, SIGKILL).
- `child-env.ts`, `private-directory.ts`.

## Testes

**Parar um agente que ainda sobe** (o Claude Code parado no diálogo de "confiar na pasta", por exemplo) corta a espera na hora: `stop()` aborta o boot, que se desfaz sozinho (PTY, ponte e arquivos) e termina sem erro; antes o `stop` esperava o boot desistir, até 60 s, e o fechamento do servidor junto.

`pnpm test` roda com uma **CLI falsa** (`test-fixtures/fake-claude.mjs` e, para o Codex, `test-fixtures/fake-codex.mjs`, um script Node que imprime o rodapé, chama os hooks por HTTP, lê a
entrada e chama o `mcp-neurons` de verdade) e não gasta nada. O teste com a CLI real é o `test:e2e:claude` do `@neurons/server`; o `test:e2e:permission-modes` abre uma CLI real em cada `--permission-mode` aceito (PTY e stream-json) **sem enviar prompt**, então não gasta cota.

`node-pty` 1.1.0 traz binário pronto para Windows e macOS (no Linux ele compila no `postinstall`; por isso está em `allowBuilds`).
