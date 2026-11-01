# Spike T05 — Claude Code em PTY (runtime de terminal da T08)

> **Status: PARCIAL.** As perguntas 1 e 8 estão respondidas com evidência. A pergunta 5 está provada só do lado do servidor MCP (cliente oficial do SDK). As perguntas 2, 3, 4, 6 e 7 **ficaram bloqueadas**: a CLI do Claude Code disponível nesta máquina não tem login de assinatura utilizável e pediu login. Pela regra do spike (login exigido → parar e relatar), nada foi contornado e nenhum prompt foi enviado ao modelo. Gasto de assinatura: zero.

Ambiente: Windows 10, Node 24.21, npm 11, sem Build Tools. Claude Code 2.1.309 (a embutida no app desktop, `claude.exe`).

## Resultado por pergunta

### 1. PTY sem compilador — **resolvida: os três funcionam**

Cada pacote foi instalado em pasta limpa e testado com `spawn('cmd.exe', ['/c','echo hello-pty'])` (saída lida, `onExit` com código 0):

| Pacote | Versão | Resultado |
| --- | --- | --- |
| `node-pty` | 1.1.0 | **Funciona.** Traz `prebuilds/win32-x64` (e `win32-arm64`, `darwin-*`). |
| `@lydell/node-pty` | 1.2.0-beta.18 | Funciona. |
| `@homebridge/node-pty-prebuilt-multiarch` | 0.15.0 | Funciona. |

Escolha para o spike: **`node-pty` 1.1.0** (ordem pedida, oficial, sem compilador). `@lydell/node-pty` é a reserva (é beta).

Pegadinhas do Windows, todas medidas:

- O npm 12 bloqueia scripts de instalação (`npm warn install-scripts ... node-pty@1.1.0`). Isso **não atrapalha**: o pacote já vem com o binário pronto e o PTY abre sem rodar `install`.
- `pty.kill()` com a CLI ainda viva falha com `AttachConsole failed` (`conpty_console_list_agent.js`) e o processo do spike pode ficar pendurado. Solução usada: `taskkill /pid <pid> /T /F` (mata a árvore) em vez de `kill()`. Com isso o spike encerra em ~5 s. **A T08 precisa disso ou de equivalente.**
- Terminar o script sem `process.exit()` deixa o loop vivo (handles do conpty); o `echo` do teste travava até o timeout por isso.
- `npm` pode falhar ao gravar `_logs` no cache padrão desta máquina (`C:\Users\rafae\AppData\Local\npm-cache\_logs`). Contornei com `npm_config_cache` local (`spikes/terminal/.npm-cache`, ignorado no git).

### 2. Subir o Claude Code no PTY — **bloqueada (login)**

O PTY sobe o `claude.exe` com `cwd` em `spikes/terminal/sandbox` e a saída chega (evidência: logo, tema, seletor de login). Mas a CLI avulsa **não está autenticada**:

```
claude auth status
{ "loggedIn": false, "authMethod": "none", "apiProvider": "firstParty", ... }
```

Sequência de telas ao subir na primeira vez (a CLI embutida nunca completou o onboarding: `hasCompletedOnboarding` ausente em `~/.claude.json`):

1. `Choose the text style that looks best with your terminal` (tema).
2. `Select login method: 1. Claude account with subscription · 2. Anthropic Console · 3. 3rd-party platform`.

Na tela 2 o spike para. Ações que alteraram o estado local, para registro:

- Enter no seletor de tema (duas execuções), aceitando o padrão "Dark mode". Isso pode ter gravado o tema em `~/.claude.json` do usuário.
- O diálogo "confiar nesta pasta" **não chegou a aparecer**, então nada foi confirmado.
- Não li nem copiei credenciais (a tentativa de inspecionar `~/.claude/.credentials.json` foi bloqueada e não foi repetida). Não usei `CLAUDE_CODE_*` do host nem copiei credenciais para outra `CLAUDE_CONFIG_DIR` (a rotação do token OAuth poderia deslogar o usuário do app).

Como destravar (decisão do usuário): rodar `claude auth login` uma vez na máquina (fluxo oficial no navegador) e depois `npm run spike`.

### 3. Detecção de ociosidade — **bloqueada; implementada, não medida**

O `src/spike.mjs` calcula os três sinais em paralelo e grava os três tempos em `logs/last-run.json`:

- (a) silêncio de saída por `SILENCE_MS` (padrão 1500 ms);
- (b) padrão do rodapé/caixa de entrada na tela (`? for shortcuts` / `❯`);
- (c) hook `Stop` (`sandbox/.claude/settings.json` → `src/hook.mjs` → POST no Hub local), mais `Notification`, `UserPromptSubmit` e `SessionStart`.

**Hipótese a confirmar (não é resultado):** o hook `Stop` deve ser o sinal confiável (fim de turno explícito), o silêncio dá falso positivo durante chamadas longas de ferramenta/pensamento, e o padrão de tela é frágil a mudanças de versão da TUI. A heurística recomendada é "Stop hook como verdade; silêncio só como rede de segurança com timeout longo". Falta a medição.

### 4. Injetar mensagem — **bloqueada; implementada**

`inject()` escreve o texto, espera 150 ms e envia `\r` separado. Multilinha vai em bracketed paste (`ESC[200~ … ESC[201~`) e só então o `\r`. Não testado contra a TUI.

### 5. MCP — **servidor validado; integração com a CLI bloqueada**

`src/mcp-server.mjs`: servidor stdio com o SDK oficial (`@modelcontextprotocol/sdk` 1.32.2), ferramenta `send_message(to, text)` que faz POST no Hub. Teste sem a CLI (`node src/mcp-selftest.mjs`):

```
tools: [ 'send_message' ]
resultado: [{"type":"text","text":"entregue a agente-b"}]
hub recebeu: {"at":...,"to":"agente-b","text":"ola"} em 176ms
```

O spike passa para a CLI: `--mcp-config logs/mcp-config.json --strict-mcp-config --allowedTools mcp__neurons__send_message --setting-sources project --model haiku` (flags conferidas em `claude --help` da 2.1.309). Falta confirmar que o Claude chama a ferramenta de fato.

### 6. Latência — **bloqueada**

O script mede: injetar → primeiro byte (`firstByteMs`), injetar → chamada MCP (`mcpCall.ms`) e injetar → ocioso por cada detector (`idleMs`). Sem números.

### 7. `claude -p --input-format stream-json --output-format stream-json` — **bloqueada (não testado)**

Confirmado só que a CLI 2.1.309 aceita `-p`, `--input-format`, `--output-format`, `--include-partial-messages`, `--max-budget-usd`, `--session-id` e `--no-session-persistence` (`claude --help`). Qualquer comparação PTY × stream-json abaixo é **expectativa a validar**, não medição:

| | PTY (TUI) | stream-json (`-p`) |
| --- | --- | --- |
| Terminal visível ao usuário | Sim (xterm.js) | Não; só renderização própria |
| Fim de turno | Inferido (hook `Stop`) | Provavelmente explícito no evento final |
| Uso/custo | Não estruturado | Provavelmente nos eventos de resultado |
| Fragilidade | Alta (TUI, escapes, diálogos de 1ª execução) | Baixa |
| Termos de uso | ver pergunta 8 | ver pergunta 8; mais próximo do Agent SDK |

### 8. Termos de uso — **respondida (só o que as fontes dizem)**

Fonte principal (Anthropic, lida em 2026-11-01): [Legal and compliance — Claude Code](https://code.claude.com/docs/en/legal-and-compliance), seção "Authentication and credential use", e a página [Authentication](https://code.claude.com/docs/en/authentication).

O que a página diz:

- O OAuth da assinatura "é destinado exclusivamente" a quem comprou os planos (Free/Pro/Max/Ultra/Team/Enterprise) e "projetado para o uso comum do Claude Code e de outros aplicativos nativos da Anthropic".
- Quem constrói produtos que interagem com o Claude, **incluindo com o Agent SDK**, deve usar chave de API do Console ou provedor de nuvem.
- A Anthropic **não permite** que desenvolvedores terceiros ofereçam login claude.ai nos próprios aplicativos nem roteiem requisições por credenciais Free/Pro/Max/Ultra em nome dos usuários. Também proíbe coletar, armazenar ou intermediar credenciais ou tokens de sessão claude.ai: o login tem de ser completado pelo fluxo da própria Anthropic.
- A mesma página diz que isso **não impede** o usuário final de entrar no binário Claude Code **não modificado** com a própria assinatura, inclusive quando uma plataforma hospeda o Claude Code. Para embutir/rodar o Claude Code em produtos: binário sem modificação, sem remover métodos de autenticação, e cada usuário autentica com a própria credencial; o cliente não pode pagar/revender/intermediar o uso.
- Os limites dos planos "assumem uso comum e individual do Claude Code e do Agent SDK". A Anthropic reserva o direito de aplicar essas restrições sem aviso. Dúvidas sobre o seu caso: contatar o comercial.
- `claude setup-token` / `CLAUDE_CODE_OAUTH_TOKEN` é descrito na página de Authentication como "para CI e scripts", e o token só faz requisições ao modelo.

O que **não** dá para concluir daqui: se um orquestrador que controla o binário oficial por PTY, para o próprio usuário, na máquina dele, está dentro do "uso comum e individual"; e se `claude -p` controlado por outro programa conta como "outro produto". A página não trata esses casos pelo nome. Reportagens secundárias descrevem bloqueios do lado do servidor em clientes de terceiros, mas não foram verificadas aqui e não valem como fonte. **Recomendação de processo:** antes de lançar para terceiros, perguntar ao comercial da Anthropic; para o uso pessoal do dono do projeto, manter o binário oficial sem modificação, cada usuário com o próprio login, e nunca guardar ou repassar tokens.

## Recomendação provisória para a T08

Sem a medição das perguntas 2 a 7, a decisão PTY × stream-json **não deve ser fechada**. O que já se sabe e é seguro assumir:

1. `node-pty` 1.1.0 resolve o PTY no Windows sem compilador. Encerrar sempre por `taskkill /T`.
2. O servidor MCP `neurons` em stdio com o SDK oficial funciona e fala com um Hub HTTP local.
3. A T08 deve tratar "CLI não autenticada / onboarding pendente" como estado de primeira classe (aqui a CLI embutida nunca tinha sido configurada), em vez de supor que o login existe.
4. Desenhar o runtime com a interface `injetar / ocioso / saída` isolada, para trocar PTY por stream-json (ou ter os dois) sem mexer no Hub.

## Limites e riscos

- A CLI embutida no app desktop muda de caminho a cada atualização (`CLAUDE_BIN` ou a pasta de versão mais nova) e não tem login próprio; o login do app é entregue por variáveis do host.
- Primeira execução abre diálogos (tema, login, confiar na pasta) que precisam de tratamento explícito.
- Termos de uso: ver pergunta 8.
- O `~/.claude.json` do usuário pode ter recebido o tema (ver pergunta 2).

## Como reproduzir

```bash
cd spikes/terminal
npm install
npm run spike            # volta completa; aborta com mensagem clara se a CLI pedir login
node src/mcp-selftest.mjs  # valida só o servidor MCP, sem a CLI e sem custo
```

Variáveis: `CLAUDE_BIN` (caminho do `claude.exe`), `SILENCE_MS` (padrão 1500). Os logs ficam em `spikes/terminal/logs/` (ignorados no git).

Para destravar as perguntas 2 a 7: `claude auth login` (uma vez, no navegador) e `npm run spike`. Se aparecer "confiar nesta pasta", confirmar só para `spikes/terminal/sandbox`.
