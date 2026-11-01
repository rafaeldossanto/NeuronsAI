# Spike T05 — Claude Code em PTY (runtime de terminal da T08)

**Veredito: dá para construir a T08 em cima de PTY + hooks + MCP.** A volta completa (PTY → ociosidade → injeção → o Claude chama `send_message` do MCP → o Hub registra → fim de turno) funcionou 3 de 3 vezes. A sessão estruturada `claude -p … stream-json` também funcionou e é a opção mais simples para agentes sem tela. Recomendação: **PTY como padrão para o agente "terminal" (o usuário vê a CLI), com o hook `Stop` como sinal de fim de turno**, e `stream-json` guardado como segundo runtime (ver "Recomendação para a T08").

Ambiente: Windows 10, Node 24.21, npm 11, sem Build Tools. Claude Code 2.1.309 (a embutida no app desktop), modelo `haiku`, login de assinatura Pro do usuário (feito durante o spike). Gasto: 4 turnos de um prompt curto no PTY, 2 no `stream-json`, mais uma sonda ("diga ok").

## Resultado por pergunta

### 1. PTY sem compilador — os três funcionam

Cada pacote foi instalado em pasta limpa e testado com `spawn('cmd.exe', ['/c','echo hello-pty'])` (saída lida, `onExit` com código 0):

| Pacote | Versão | Resultado |
| --- | --- | --- |
| `node-pty` | 1.1.0 | **Funciona.** Traz `prebuilds/win32-x64` (e `win32-arm64`, `darwin-*`). |
| `@lydell/node-pty` | 1.2.0-beta.18 | Funciona. |
| `@homebridge/node-pty-prebuilt-multiarch` | 0.15.0 | Funciona. |

Escolha: **`node-pty` 1.1.0** (primeiro da ordem, oficial, sem compilador). `@lydell/node-pty` é a reserva (beta).

Pegadinhas do Windows, todas medidas:

- O npm 12 bloqueia scripts de instalação (`npm warn install-scripts … node-pty@1.1.0`). **Não atrapalha**: o binário já vem no pacote.
- `pty.kill()` com a CLI viva falha com `AttachConsole failed` e o processo pode ficar pendurado. Solução: `taskkill /pid <pid> /T /F` (mata a árvore). **A T08 precisa disso.**
- Sem `process.exit()` o script não encerra (handles do conpty).
- O cache padrão do npm desta máquina falhou ao gravar `_logs`; usei `npm_config_cache` local (`.npm-cache`, ignorado no git).

### 2. Subir o Claude Code no PTY — funciona, com ressalvas

Comando efetivo (cwd = `spikes/terminal/sandbox`):

```
claude.exe --model haiku --permission-mode default --setting-sources project \
  --mcp-config logs/mcp-config.json --strict-mcp-config --allowedTools mcp__neurons__send_message
```

- **Chegar ao prompt leva 7–10 s** (medido: 7,2 / 10,2 / 7,6 s do spawn até a caixa de entrada livre).
- **A saída é redesenho por escape codes**, não texto corrido: ler `plain()` dos bytes não serve. É preciso um emulador de terminal no servidor. Usei `@xterm/headless` (o mesmo modelo do xterm.js), lendo a tela renderizada. Isso entra como requisito da T08.
- **Diálogos de primeira execução** (a CLI embutida nunca tinha sido configurada): tema → "Security notes" (Enter) → "Claude in Chrome extension detected" (Enter escolhe "No, keep browser tools off") → prompt. O de "confiar nesta pasta" **não apareceu** (nada confirmado). O spike trata os quatro por regex na tela e **aborta se aparecer a escolha de login**, sem automatizá-lo.
- **O ambiente do app host vaza para o filho**: `CLAUDE_CODE_CHILD_SESSION` (desliga o salvamento de transcrição), modo auto e `ANTHROPIC_BASE_URL`. O spike remove tudo que começa com `CLAUDE*`/`ANTHROPIC*` (`cleanEnv`). A T08 deve montar o ambiente do filho explicitamente.
- A CLI embutida do app desktop **não tinha login próprio** (`claude auth status` → `loggedIn:false`); o spike só andou depois de o usuário rodar `claude auth login`.

### 3. Detecção de ociosidade — **o hook `Stop` é o sinal confiável**

Medido nos 3 turnos (ms desde o `Stop`; "falso positivo" = disparou antes do fim do turno):

| Detector | Falso positivo antes do `Stop`? | Disparo depois do `Stop` | Veredito |
| --- | --- | --- | --- |
| (c) Hook `Stop` | Não | referência (t=0) | **Confiável.** Fim de turno explícito, vem do próprio Claude Code. |
| (b) Rodapé da tela: `? for shortcuts` presente e `esc to interrupt` ausente | Não (nas amostras de 47 telas: ocupado = `esc to interrupt`, livre = `? for shortcuts`) | +450 / +170 / +242 ms | **Bom como confirmação**, depende de texto da TUI (frágil a versão). |
| (a) Silêncio de saída por 1500 ms | Não nestes turnos, porque o spinner redesenha sem parar | +1950 / +1670 / +1770 ms | **Só rede de segurança.** Atrasa pelo menos o valor do limite e falharia com a TUI parada em diálogo ou ferramenta longa sem spinner. |

Atenção: o primeiro padrão de prompt que tentei (`❯` na caixa de entrada) dava **falso positivo** o tempo todo, porque a caixa de entrada fica sempre visível, inclusive durante o turno. Padrão de tela precisa olhar o **rodapé**, não a caixa.

**Heurística escolhida para a T08:** `Stop` hook = ocioso. Rodapé livre (`? for shortcuts` sem `esc to interrupt`) como confirmação, com silêncio de ~1,5 s e timeout longo apenas como rede de segurança se o hook não chegar (ex.: CLI travou ou o hook foi desligado). Injetar só depois de ocioso.

### 4. Injetar mensagem — funciona; o Enter precisa de cuidado

- Escrever o texto e enviar `\r` **150 ms depois não submeteu** (o texto ficou na caixa; o Enter foi tratado como parte da colagem). Com ~800 ms funcionou.
- Solução usada: escrever o texto, **esperar o eco na tela** (xterm headless), esperar mais 400 ms, enviar `\r` e **confirmar pelo hook `UserPromptSubmit`**; se não vier em 2,5 s, reenviar. Resultado: 1 Enter em 3 de 3 turnos.
- Multilinha: o spike envolve em bracketed paste (`ESC[200~ … ESC[201~`) antes do `\r`. **Não foi exercitado** (os prompts de teste são de uma linha).
- A CLI respondeu ao prompt injetado nas 3 rodadas.

### 5. MCP — funciona de ponta a ponta

`src/mcp-server.mjs`: servidor stdio com `@modelcontextprotocol/sdk` 1.32.2, ferramenta `send_message(to, text)`, que faz POST no Hub local. Configurado com `--mcp-config … --strict-mcp-config` e pré-liberando **só** `--allowedTools mcp__neurons__send_message`, sem `--dangerously-skip-permissions`, em `--permission-mode default`.

Evidência: nas 3 rodadas o Hub recebeu `{"to":"agente-b","text":"ola do spike"}` e a tela mostrou `Called neurons` e `feito`. O `init` do `stream-json` confirma `mcp_servers: [{name:"neurons", status:"connected"}]` e `tools: [mcp__neurons__send_message]`. Também validado sem a CLI (`npm run spike:mcp-selftest`: cliente do SDK → 176 ms até o Hub).

### 6. Latência (PTY, ms desde o início da injeção)

| Rodada | 1º byte (eco) | → `UserPromptSubmit` | → chamada MCP no Hub | → `Stop` hook | → rodapé livre | → silêncio |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 2151 | 4625 | 11102 | 14359 | 14808 | 16308 |
| 2 | 801 | 2954 | 8088 | 10453 | 10623 | 12123 |
| 3 | 1036 | 2605 | 6473 | 8345 | 8587 | 10113 |

Leitura:

- "Primeiro byte" é o **eco do que foi digitado**, não a resposta do modelo; a resposta só começa após `UserPromptSubmit`. O trecho injetar → `UserPromptSubmit` (2,6–4,6 s) inclui a espera do eco e os 400 ms que adicionei por segurança; dá para enxugar na T08.
- Do envio (`UserPromptSubmit`) até a chamada MCP: 3,9–6,5 s (modelo + subida do servidor MCP). Até o `Stop`: 5,7–9,7 s. **Injetar → ocioso de novo (pelo `Stop`): 8,3–14,4 s** para um prompt de uma frase com uma chamada de ferramenta no `haiku`.
- Os números variam com carga; são 3 amostras, não estatística.

### 7. Alternativa estruturada: `claude -p --input-format stream-json --output-format stream-json`

Testado (`npm run spike:stream-json`): uma só sessão de processo, dois turnos por stdin (`{"type":"user","message":{"role":"user","content":"…"}}\n`), `--verbose` obrigatório para stream-json de saída. O MCP foi chamado no turno 1 e o turno 2 respondeu `agente-b` (**a sessão persiste e lembra**).

| Medida | Valor |
| --- | --- |
| spawn → evento `init` (frio) | 12,1 s |
| Turno 1 (inclui partida): primeiro evento / `tool_use` / `result` | 4,2 s / 14,5 s / 19,9 s |
| Turno 2 (sessão quente, resposta curta): primeiro evento / assistente / `result` | 1,6 s / 3,4 s / 4,9 s |
| Custo reportado (nocional na assinatura) | US$ 0,0049 e US$ 0,0052 |

Eventos vistos: `system:init`, `system:hook_started/hook_response`, `assistant`, `user` (resultado da ferramenta), `rate_limit_event`, `result:success`.

| | PTY (TUI) | stream-json |
| --- | --- | --- |
| Terminal visível ao usuário | **Sim** (xterm.js, é a CLI de verdade) | Não; teria de ser renderizado pela nossa UI |
| Fim de turno | Inferido: hook `Stop` + rodapé | **Explícito**: evento `result` |
| Uso/custo/erro | Não estruturado | **Sim**: `usage`, `total_cost_usd`, `is_error`, `num_turns`, `duration_ms` |
| Chamadas de ferramenta | Só na tela (ou via hook/MCP) | Eventos `tool_use` estruturados |
| Injeção | Digitar + Enter, esperar eco, confirmar por hook | Escrever uma linha JSON |
| Fragilidade | Alta: TUI, escapes, diálogos de 1ª execução, texto de rodapé muda com a versão | Baixa: protocolo documentado |
| Latência | 8–14 s/turno medido | 4,9 s no turno quente (resposta trivial); partida fria ~12 s |
| Interação do usuário no meio do turno | Sim (ele digita na CLI) | Não |

### 8. Termos de uso — o que as fontes oficiais dizem

Fonte principal (Anthropic, lida em 2026-11-01): [Legal and compliance — Claude Code](https://code.claude.com/docs/en/legal-and-compliance), seção "Authentication and credential use", e a página [Authentication](https://code.claude.com/docs/en/authentication).

- O OAuth da assinatura é "destinado exclusivamente" a quem comprou os planos (Free/Pro/Max/Ultra/Team/Enterprise) e projetado para o uso comum do Claude Code e de outros aplicativos nativos da Anthropic.
- Quem constrói produtos que interagem com o Claude, **incluindo com o Agent SDK**, deve usar chave de API do Console ou provedor de nuvem.
- A Anthropic **não permite** que desenvolvedores terceiros ofereçam login claude.ai nos próprios aplicativos nem roteiem requisições por credenciais Free/Pro/Max/Ultra em nome dos usuários. Também proíbe coletar, armazenar ou intermediar credenciais ou tokens de sessão: o login tem de ser completado pelo fluxo da própria Anthropic.
- A mesma página diz que isso **não impede** o usuário final de entrar no binário Claude Code **não modificado** com a própria assinatura, inclusive quando uma plataforma hospeda o Claude Code. Para rodar o Claude Code dentro de produtos: binário sem modificação, sem remover métodos de autenticação, cada usuário com a própria credencial, sem pagar/revender/intermediar o uso por ele.
- Os limites dos planos "assumem uso comum e individual do Claude Code e do Agent SDK". A Anthropic pode aplicar essas restrições sem aviso. Dúvidas sobre o caso concreto: contatar o comercial.
- `claude setup-token`/`CLAUDE_CODE_OAUTH_TOKEN` é descrito para CI e scripts.

**O que as fontes não respondem:** se um orquestrador que controla o binário oficial por PTY, para o próprio usuário, na máquina dele, é "uso comum e individual"; e se `claude -p` controlado por outro programa conta como "outro produto"/Agent SDK. A página não trata esses casos pelo nome, e este documento não conclui além disso. Há relatos de bloqueios do lado do servidor a clientes de terceiros em fontes secundárias, não verificados aqui.

Postura segura para a T08, coerente com o texto: usar o binário **oficial e sem modificação**, **cada usuário com o próprio login** feito pelo fluxo da CLI, **nunca ler, guardar ou repassar tokens**, não revender acesso. Antes de qualquer lançamento para terceiros, perguntar ao comercial da Anthropic.

## Recomendação para a T08

1. **Runtime "terminal" = PTY** (`node-pty` 1.1.0 + `@xterm/headless` no servidor para a tela, `xterm.js` no cliente). Fim de turno por **hook `Stop`** (confirmado pelo rodapé), injeção por texto + Enter com eco e confirmação por `UserPromptSubmit`. É o que entrega "terminal visível para o usuário".
2. **MCP `neurons` por `--mcp-config` + `--strict-mcp-config`**, com `--allowedTools` listando só as ferramentas do Hub. Funcionou sem `--dangerously-skip-permissions`.
3. **Isolar a interface do runtime** (`injetar`, `ocioso`, `saída`, `encerrar`) para ter também um runtime **stream-json** para agentes sem tela: custo/uso estruturados, fim de turno explícito, muito menos frágil. É o runtime a preferir quando ninguém precisa ver a CLI.
4. Tratar como estados de primeira classe: CLI **não autenticada**, **diálogos de primeira execução** e **CLI sem login próprio** (aqui a embutida do app não tinha).
5. Montar o ambiente do filho explicitamente (sem herdar `CLAUDE*`/`ANTHROPIC*` do host) e encerrar a árvore com `taskkill /T` no Windows.
6. Fixar a versão da CLI: padrões de tela (diálogos, rodapé) são da 2.1.309 e vão mudar. O hook `Stop` e o `stream-json` são contratos mais estáveis do que a tela.

## Limites e riscos

- **Fragilidade da TUI**: diálogos novos podem bloquear o spike; o texto do rodapé muda entre versões. Por isso o `Stop` é o sinal principal.
- **Latência de 8–14 s por turno** no PTY; a injeção com eco/Enter adicionou ~0,5–2 s que dá para reduzir.
- **Caminho do binário**: a CLI embutida no app desktop muda a cada atualização e não tem login próprio. Em produção o usuário precisa ter a CLI instalada e autenticada por ele.
- **Termos de uso**: seção 8; zona cinza para controle programático, a validar com a Anthropic.
- **Estado do usuário alterado**: no início (antes do login), Enter no seletor de tema gravou o tema padrão em `~/.claude.json`; as aprovações dos diálogos de onboarding acima também ficam gravadas lá. O usuário está **logado** com `claude auth login` (`claude auth logout` desfaz).
- 3 amostras de latência no `haiku`, um prompt curto: não generalizar para turnos longos, ferramentas lentas ou outros modelos. Multilinha/bracketed paste e o diálogo de "confiar na pasta" não foram exercitados. Só Windows testado.

## Como reproduzir

```bash
cd spikes/terminal
npm install
claude auth login            # uma vez; a CLI embutida do app desktop nao tem login proprio
npm run spike                # volta completa no PTY (grava logs/last-run.json e logs/screens.json)
npm run spike:stream-json    # alternativa estruturada, 2 turnos na mesma sessao (logs/stream-json.json)
npm run spike:mcp-selftest   # valida so o servidor MCP, sem CLI e sem custo
```

Variáveis: `CLAUDE_BIN` (caminho do `claude.exe`; sem ela procura a versão mais nova em `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code`), `SILENCE_MS` (padrão 1500). Os logs ficam em `spikes/terminal/logs/` (ignorados no git). O diálogo de confiar na pasta, se aparecer, deve ser confirmado só para `spikes/terminal/sandbox`.
