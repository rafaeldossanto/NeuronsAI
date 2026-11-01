---
tags: [neuronsai, plano, tarefas]
atualizado: 2026-11-01
---

# Plano de Implementação

Decisões e arquitetura em [[NeuronsAI]]. Princípio da ordem: **a comunicação entre agentes
nasce antes do modelador.** Até a T10 tudo roda sem tela, por testes e por um grafo escrito
em JSON. Assim a parte difícil (agentes vivos conversando, terminais, custo, guardas) fica
provada antes de gastar tempo com canvas.

| Fase | Tarefas | Ao fim dela |
|---|---|---|
| 0 · Fundação | T01–T05 | Monorepo, esquema do grafo, servidor e banco de pé, fornecedores e terminal provados |
| 1 · Comunicação | T06–T10 | Agentes de API e de terminal conversando entre si pelo Hub, com ferramentas e guardas |
| 2 · Modelador | T11–T15 | Desenhar, configurar e assistir as conversas ao vivo no canvas |
| 3 · Mundo de fora | T16–T18 | Gatilhos externos, templates e landing publicada |
| Distribuição | T19–T23 | CI em 3 sistemas, banco embutido, app desktop e instaladores para Windows, macOS e Linux |
| Nuvem | T24–T26 | Protocolo de runner, contas e servidor + banco na AWS |
| Depois | Backlog | Runners hospedados (estilo Hostinger) e o que não entrou no plano |

## Ordem de execução

- Feito: T01, T02, T03 e o spike T05. Em andamento: T06 e T09.
- Depois: T08 + T19 → T20 → T10 → T24 → T11 → T21 → T12–T15 → T22 → T25 → T16–T18.
- **Por último (têm custo):** T04 e T07 (chave de API), T26 (AWS) e T23 (assinatura de código). Até a T26, o webhook do WhatsApp (T16) sai por túnel.

**Paralelismo possível:** T04 e T05 em paralelo com T02–T03. A Fase 2 pode começar assim que
a T10 publicar a API (o modelador só depende do contrato da T02 e da API).

---

## Fase 0 · Fundação

### T01 — Repositório e monorepo

- `git init` em `Work/NeuronsAI`, remote `github.com/rafaeldossanto/NeuronsAI` (o Rafael cria).
- `corepack enable` para ter o `pnpm` (Node 24.21 já está instalado; o pnpm não).
- pnpm workspaces + Turborepo: `apps/web`, `apps/server`, `apps/site`,
  `packages/graph-schema`, `packages/providers`, `packages/mcp-neurons`.
- TypeScript estrito, ESLint + Prettier na raiz, Vitest em todos os pacotes.
- `.gitignore`: `node_modules`, `dist`, `.env*`, `*.pem`, `.obsidian/workspace.json`.
- `Docs/` fica dentro do repo como cofre.
- CI no GitHub Actions: `pnpm install --frozen-lockfile` e `turbo lint test build`.

**Pronto quando:** `pnpm turbo test build` verde local e no CI, com um teste de exemplo por pacote.

### T02 — Esquema do grafo (`packages/graph-schema`)

O contrato central: o modelador grava, o servidor lê. Tudo em zod, tipos exportados.

- `GraphDefinition { schemaVersion, id, name, nodes[], links[], annotations[] }`.
- Blocos (união discriminada por `type`):
  - `trigger` — `manual` | `webhook` | `schedule`; aponta para o agente de entrada.
  - `agent` — `name` (único no grafo, é o endereço), `role`, `instructions`, `effort`
    (`low|medium|high|xhigh|max`), `budgetUsd?`, `idleTimeoutSec?`, e `runtime`:
    - `{ kind: "api", provider, model }`
    - `{ kind: "terminal", cli: "claude" | "codex" | "gemini" | "custom", command?, args[], cwd }`
  - `tool` — `mcp { command|url, allowedTools[] }` | `http { method, url, headers, bodySchema }`
    | `obsidian { vaultPath, readOnly: true }`.
- Ligação: `{ id, from, to, kind: "talk" | "uses", bidirectional, maxMessages? }`.
  `talk` liga agente a agente (permissão de iniciar conversa); `uses` liga agente a ferramenta.
- `annotations[]`: formas livres, notas, texto, grupos; nunca executam.
- `validateGraph()`: nomes de agente únicos, um gatilho com destino, toda ligação aponta para
  bloco existente, `uses` só de agente para ferramenta, agente de terminal com `cwd` absoluto.
- `peersOf(graph, agentName)`: quem o agente pode chamar e quem pode chamá-lo (usado no
  briefing do agente e na checagem do Hub).
- Migração por `schemaVersion` (começa em 1).
- Fixtures em `examples/`: `two-agents.json` (dois agentes de API conversando),
  `sales-followup.json` (vendedor → pós-venda com ferramenta HTTP) e
  `mixed.json` (agente de API + Claude Code no terminal).

**Pronto quando:** testes para cada regra do `validateGraph` e do `peersOf`, e as fixtures validando.

### T03 — Servidor e banco

- `apps/server` em NestJS 11 com adaptador Fastify. Módulos: `graphs`, `runs`, `hub`,
  `agents` (supervisor e runtimes), `providers`, `tools`, `secrets`, `shared`.
  O `hub` não conhece HTTP nem runtime concreto; depende de interfaces.
- Postgres 18 nativo: `db/setup-local.sql` cria o usuário `neurons` e o database `neurons_dev`
  (senha por `psql -v`, nunca em arquivo, depois em `NEURONS_DB_PASSWORD`).
- Drizzle ORM + migrations. Tabelas iniciais:
  - `graphs`, `graph_versions` (definição imutável, `version` incremental);
  - `runs` (`graph_version_id`, `status`, `budget_usd`, `spent_usd`);
  - `messages` (`run_id`, `from_agent`, `to_agent`, `kind: message|ask|reply`, `reply_to?`,
    `body`, `created_at`, `delivered_at?`, `acked_at?`);
  - `run_events` (append-only: `run_id`, `seq`, `type`, `agent?`, `payload jsonb`, `at`);
  - `secrets` (chaves de API cifradas com AES-256-GCM, chave mestra em `NEURONS_MASTER_KEY`).
- Gateway WebSocket (`/ws`) com assinatura por execução; reconexão retoma pelo `seq`.
- `/health`; erros como `{ code, message }`. Servidor escuta só em `127.0.0.1`.
- Testes de integração com Testcontainers (Postgres 18).

**Pronto quando:** servidor sobe na 3100, migrations rodam no `neurons_dev`, integração verde.

### T04 — Spike dos fornecedores (agentes de API)

- Script em `packages/providers/spike/` mandando o mesmo pedido com uma ferramenta para
  Anthropic, OpenAI e um compatível com OpenAI (Ollama ou OpenRouter). Chaves por variável de
  ambiente; **não colar chave no chat**.
- Nota `Docs/Spikes/Fornecedores.md` respondendo:
  1. Como cada um expressa esforço e a tabela de tradução dos 5 níveis.
  2. Formato de chamada de ferramenta e de streaming.
  3. Onde vem o uso (entrada, saída, cache) para calcular US$.
  4. O que acontece quando o modelo não suporta ferramenta ou esforço.

**Pronto quando:** nota com as quatro respostas e a tabela preenchida.

### T05 — Spike do terminal (agentes de CLI)

O maior risco técnico. Provar no Windows antes de construir.

- Script em `apps/server/spike/terminal/` que, com `node-pty`:
  1. Sobe o `claude` (e o `codex`, se instalado) num pseudo-terminal com `cwd` definido.
  2. Detecta quando a CLI está **ociosa** (esperando entrada). Testar heurísticas: silêncio de
     saída por N ms, padrão do prompt, e se a CLI oferece algo melhor (hooks do Claude Code,
     modo `--output-format stream-json`/SDK).
  3. Injeta uma mensagem como se fosse digitada e confirma que a CLI responde.
  4. Configura um servidor MCP de teste na sessão e confirma que a CLI chama a ferramenta.
  5. Mede atraso entre injetar e a CLI começar a responder.
- Comparar com o modo do Orca (CLI própria chamada pelo agente) e registrar a escolha.
- Conferir os termos vigentes de uso da CLI oficial com login de assinatura dentro de outra
  ferramenta, e registrar o resultado.
- Nota `Docs/Spikes/Terminal.md` com o que funcionou, a heurística escolhida e os limites.

**Pronto quando:** o script faz uma volta completa (injetar → CLI chama a ferramenta MCP →
resposta lida) com o Claude Code no Windows, e a nota está escrita.

---

## Fase 1 · Comunicação

### T06 — Hub de mensagens

- Interface `AgentRuntime { start(briefing), deliver(message), stop(), state$ }`, com
  estados `starting | busy | idle | waiting_reply | stopped | failed`.
- `Hub.send(from, to, kind, body, replyTo?)`:
  1. checa permissão (`peersOf`; `reply` sempre vale para quem escreveu);
  2. grava em `messages` e o evento `MessageSent` na mesma transação;
  3. entrega na hora se o destino está `idle`, senão deixa na caixa de entrada;
  4. marca `delivered_at` e, quando o runtime confirma, `acked_at`.
- `ask` devolve uma promessa que resolve no `reply` correspondente ou falha no timeout.
- `Supervisor`: sobe o agente na primeira mensagem, entrega a caixa de entrada em ordem (FIFO)
  sempre que ele fica ocioso, e no restart do servidor reentrega o que não teve `acked_at`.
- Briefing de cada agente: papel, instruções, lista de pares com nome e papel, regras de uso das
  ferramentas de comunicação.
- Fim da execução: `finish` de um agente, quiescência (todos ociosos, caixas vazias, nenhum `ask`
  pendente) ou parada manual.
- Runtime falso (`FakeAgentRuntime`) para os testes.

**Pronto quando:** testes com runtimes falsos cobrindo permissão negada, fila com destino
ocupado, `ask`/`reply`, timeout do `ask`, reentrega após restart e as três formas de terminar.

### T07 — Runtime de API

- `ModelProvider.run(request): AsyncIterable<ModelEvent>` com tipos próprios
  (`text | toolCall | usage | done | error`); adaptadores com o **SDK oficial** de cada
  fornecedor: `AnthropicProvider`, `OpenAIProvider`, `OpenAICompatibleProvider`. `ProviderRegistry`
  por `provider`. Esforço traduzido pela tabela da T04.
- Tabela de preços versionada; `UsageCalculator` grava `UsageRecorded` em US$.
- `ApiAgentRuntime`: mantém a conversa do agente; cada mensagem entregue vira um turno novo;
  ferramentas `send_message`, `ask`, `reply`, `list_peers`, `finish` + as ferramentas ligadas por `uses`.
- Erros retentáveis (429, 5xx, rede) com backoff; definitivos marcam `AgentFailed`.

**Pronto quando:** `two-agents.json` com modelos reais: os dois agentes conversam, um pergunta
com `ask`, o outro responde, um chama `finish`; testes de contrato dos adaptadores com respostas
gravadas.

### T08 — Runtime de terminal

- `packages/mcp-neurons`: servidor MCP (SDK oficial) com `send_message`, `ask`, `reply`,
  `list_peers`, `finish`, autenticado por um token por agente e por execução, falando com o Hub
  por HTTP local.
- `TerminalAgentRuntime` (resultado do spike T05, `Docs/Spikes/Terminal.md`): `node-pty` 1.1.0 (binário pronto para Windows, sem compilador) + `@xterm/headless` para ler a tela; **fim de turno pelo hook `Stop`** do Claude Code configurado na sessão, com o rodapé da TUI (`esc to interrupt` = ocupado, `? for shortcuts` = livre) e 1,5 s de silêncio só como confirmação; **injeção** = digitar o texto, esperar o eco na tela + 400 ms, Enter, confirmar pelo hook `UserPromptSubmit`; saída transmitida ao WebSocket.
- `StreamJsonAgentRuntime`: segundo runtime, para agentes sem tela, com `claude -p --input-format stream-json --output-format stream-json` como sessão persistente (fim de turno, uso e custo explícitos; turno quente ~5 s). Decidir aqui se vira opção do bloco no `graph-schema`.
- Os dois implementam a mesma `AgentRuntime` (injetar, ocioso/ocupado, saída, encerrar).
- Encerrar com `taskkill /T /F` no Windows (`pty.kill()` trava); matar órfãos no restart; fixar a versão suportada da CLI (os textos de tela mudam entre versões); testar prompt multilinha (o spike não cobriu).
- Esforço e modelo passados por flag/config da CLI quando ela tiver; senão, ignorados com aviso.

**Pronto quando:** `mixed.json`: um agente de API manda uma tarefa ao Claude Code no terminal,
o Claude Code pergunta algo com `ask`, recebe a resposta e avisa com `send_message` ao terminar.

### T09 — Ferramentas: MCP, HTTP e Obsidian

- Cliente MCP (SDK oficial), stdio e HTTP; só as ferramentas de `allowedTools` chegam ao agente.
- Ferramenta HTTP valida o corpo pelo `bodySchema`; segredos por nome (`{{secret:X}}`), nunca no grafo.
- Obsidian: `search`, `read`, `listLinks` restritos ao `vaultPath` (bloquear `..`, links para fora,
  `.obsidian/`). Só leitura na v1.
- Agente de terminal recebe as mesmas ferramentas pela configuração MCP da sessão.
- Cada chamada grava `ToolCalled` (ferramenta, entrada resumida, duração, erro).

**Pronto quando:** um agente responde uma pergunta lendo um cofre do Rafael (teste manual) e os
testes cobrem a fuga de diretório.

### T10 — Guardas e API pública

- Guardas: `maxMessages` por ligação e por execução; detecção de pingue-pongue (mesmo par trocando
  N mensagens sem ferramenta nem `finish`); orçamento em US$ por agente e por execução;
  `idleTimeoutSec`; parar execução (`POST /runs/{id}/stop`) encerra runtimes e terminais.
- Você como participante: `POST /runs/{id}/messages` manda mensagem a qualquer agente.
- REST: CRUD de grafos, `POST /graphs/{id}/versions` (valida e congela), execuções (iniciar,
  listar, detalhar, parar), mensagens, segredos (só escrita e listagem de nomes).
- OpenAPI gerado pelo Nest e cliente TS gerado para o `apps/web`.

**Pronto quando:** testes de cada guarda e um script que inicia `mixed.json` pela API e imprime
os eventos chegando pelo WebSocket.

---

## Fase 2 · Modelador

Visual já definido pelos estudos: fundo `#F7F7F4`, grafite, pulsos âmbar `#E9A15C`, Manrope,
nada de azul.

### T11 — Esqueleto do web

- Vite + React 19 + TypeScript, Tailwind + shadcn/ui, TanStack Query, roteador.
- Telas: lista de grafos, editor, execuções. Tokens de cor e tipografia da landing.

**Pronto quando:** navega entre as três telas consumindo a API real.

### T12 — Canvas e inspetor

- `@xyflow/react` (React Flow) com blocos para agente (ícone diferente para API e terminal),
  ferramenta e gatilho; setas simples ou duplas.
- Inspetor do bloco selecionado: Nome, Papel, Runtime (API: fornecedor e modelo; Terminal: CLI e
  pasta), Esforço, Contexto, ferramentas, orçamento.
- Validação ao vivo com o `validateGraph` da T02. Salvar rascunho, "Publicar versão", desfazer/refazer.

**Pronto quando:** desenhar o `mixed.json` do zero no canvas gera um JSON igual à fixture.

### T13 — Camada livre

- Retângulo, elipse, seta livre, texto, nota e grupo no mesmo canvas, com traço de desenho à mão
  (`roughjs`). Salvos em `annotations[]`, ignorados pelo servidor.

**Pronto quando:** anotar um grafo, salvar, reabrir e ver tudo no lugar.

### T14 — Execução ao vivo

- Abrir uma execução sobre o desenho da versão em que ela roda.
- Estado de cada agente no bloco (subindo, ocupado, ocioso, esperando resposta, falhou) e
  **pulso âmbar percorrendo a seta** a cada mensagem, no sentido de quem mandou.
- Clicar num agente abre o painel dele: a conversa (agente de API) ou o **terminal ao vivo**
  com xterm.js (agente de terminal), com campo para você escrever para ele.
- Linha do tempo de mensagens e chamadas de ferramenta, custo por agente e total, botão de parar.

**Pronto quando:** rodar o `mixed.json` com modelos reais e acompanhar tudo pela tela, inclusive
digitar no terminal do Claude Code.

### T15 — Histórico e replay

- Lista de execuções com filtros (status, versão, custo).
- Replay das mensagens de uma execução terminada no canvas, com controle de velocidade.

**Pronto quando:** o replay de uma execução mostra as mensagens na ordem certa e nas setas certas.

---

## Fase 3 · Mundo de fora

### T16 — Gatilhos externos e WhatsApp

- Gatilho `webhook` com URL e assinatura HMAC por grafo; `schedule` com cron.
- **WhatsApp Cloud API** oficial (número de teste da Meta) como gatilho e como ferramenta de
  resposta; validar `X-Hub-Signature-256`. Agente que lê mensagem de cliente começa sem
  ferramenta de escrita.
- Enquanto for local, o webhook sai por túnel (Cloudflare Tunnel).

**Pronto quando:** mensagem no número de teste dispara a execução e a resposta volta no WhatsApp.

### T17 — Templates

- "Novo grafo a partir de template": Venda → pós-venda, Pesquisa com revisor, Agente principal +
  CLIs no terminal. Cada template é uma fixture validada da T02 com textos de exemplo.

**Pronto quando:** os três templates abrem, rodam e terminam com modelos reais.

### T18 — Landing

- Trazer `E:\Notes\Design\NeuronsAI\pagina-real` para `apps/site` e publicar (Vercel ou GitHub
  Pages), com a lista de espera apontando para um destino definido pelo Rafael.
- Botões de download por sistema (Windows, macOS, Linux) apontando para a última versão no GitHub Releases.

**Pronto quando:** landing publicada no domínio escolhido.

---

## Fase de distribuição

### T19 — Pipelines de CI

- `ci.yml` (push e PR): lint, typecheck, testes unitários e build em matriz `ubuntu-latest`, `windows-latest` e `macos-latest`.
- Job de integração no Ubuntu: `test:integration` do server com Testcontainers (Postgres 18).
- Cache do pnpm e do Turbo.
- Dependabot semanal para npm e GitHub Actions, agrupando atualizações menores.
- Badge do CI no README.
- Varredura de segredos com gitleaks em todo push e PR.
- Regra de lint que proíbe `process.env` fora do módulo de config do servidor.

**Pronto quando:** CI verde nos três sistemas no primeiro push.

### T20 — Banco embutido (PGlite)

- Driver PGlite no Drizzle ao lado do `pg`, escolhido pela config (`NEURONS_DB=embedded|postgres`, padrão `embedded`); dados numa pasta do usuário, por sistema.
- As mesmas migrations nos dois bancos, incluindo os triggers que impedem UPDATE em `graph_versions` e `run_events`.
- Repositórios sem saber qual driver está por trás.
- Testes: a suíte de repositórios roda contra PGlite (sem Docker) e contra Postgres (Testcontainers).

**Pronto quando:** o servidor sobe sem nenhum Postgres instalado e a suíte passa nos dois bancos.

### T21 — App desktop (Electron)

- `apps/desktop`: Electron com o servidor NestJS no processo do app, a interface do `apps/web` na janela, porta livre escolhida na hora e acesso só local.
- `node-pty` recompilado para o Electron (`@electron/rebuild`).
- Diferenças por sistema num lugar só: pasta de dados, localizar o Claude Code CLI, encerrar árvore de processos, menu e atalhos.
- Ícone e nome NeuronsAI; uma instância por vez.

**Pronto quando:** o app abre no Windows com o modelador e roda uma execução com agente de terminal; o build local (`electron-builder --dir`) passa nos três sistemas pelo CI.

### T22 — Release multiplataforma

- `release.yml` disparado por tag `v*`: matriz macOS (dmg arm64 e x64), Windows (instalador NSIS) e Linux (AppImage e deb) com `electron-builder`.
- Publica rascunho no GitHub Releases com os instaladores e checksums.
- Atualização automática com `electron-updater` lendo o GitHub Releases.
- Sem assinatura nesta etapa: README e página de download explicam o aviso do sistema na primeira abertura (SmartScreen no Windows, Gatekeeper no macOS).

**Pronto quando:** uma tag gera os instaladores dos três sistemas e o app instalado se atualiza sozinho para a versão seguinte.

### T23 — Assinatura de código (por último, tem custo)

- macOS: conta Apple Developer, assinatura e notarização no `release.yml`.
- Windows: certificado de assinatura (ou Azure Trusted Signing) no `release.yml`.
- Segredos do CI só nos secrets do GitHub, nunca no repositório.
- Ativar o Sign in with Apple da T25 com a mesma conta Apple Developer (Service ID, chave `.p8`).

**Pronto quando:** os instaladores abrem sem aviso no macOS e no Windows.

---

## Fase de nuvem

### T24 — Protocolo de runner

- `packages/runner-protocol`: mensagens versionadas em zod (registrar, heartbeat, iniciar agente, entregar mensagem, confirmar, mudança de estado, saída do terminal, parar agente).
- `RemoteAgentRuntime` no servidor, implementando a mesma `AgentRuntime`, e o lado runner que hospeda os runtimes de terminal e stream-json da T08.
- Runner embutido no mesmo processo (perfil `local`) e runner separado conectando por WebSocket de saída, com token por runner (perfil `hybrid`).
- Reconexão sem perder mensagem (o Hub já reentrega o que não teve confirmação).

**Pronto quando:** a mesma execução do `mixed.json` roda com o runner no mesmo processo e com o runner em outro processo, mudando só a configuração.

### T25 — Contas e multiusuário

- **Login com Google e com Apple** (OpenID Connect com PKCE), atrás de uma interface de provedor de identidade para dar para acrescentar outros depois. No app desktop, o login abre o **navegador do sistema** e volta para o app por deep link `neuronsai://` (ou endereço local de retorno) — nunca numa janela embutida, que o Google bloqueia.
- Uma conta pode ter Google e Apple ligados (vinculados pelo e-mail verificado); a Apple pode esconder o e-mail real (relay), então o vínculo também aceita o identificador do provedor.
- Sessão do NeuronsAI com tokens próprios (acesso curto + renovação rotativa); no app desktop ficam no cofre do sistema (`safeStorage` do Electron: Keychain, Credential Manager, libsecret).
- Credenciais dos provedores (client secret do Google, chave `.p8` da Apple) só na config/Secrets Manager, nunca no código.
- Organizações e papéis; grafos, execuções, runners e segredos isolados por organização.
- **Depende do Rafael:** criar o OAuth client no Google Cloud (grátis). O Sign in with Apple exige a conta Apple Developer (US$ 99/ano, a mesma da T23): o código fica pronto aqui e a Apple é ativada quando a conta existir, junto da T23.
- Runner vinculado a uma conta por token emitido pelo servidor e revogável.
- O perfil `local` continua funcionando sem conta.

**Pronto quando:** dois usuários no mesmo servidor não enxergam nada um do outro (testes de isolamento).

### T26 — Infra na AWS (tem custo)

- Infraestrutura como código com AWS CDK em TypeScript: servidor em contêiner (ECS Fargate), Postgres gerenciado (RDS), segredos no Secrets Manager, domínio e TLS.
- Deploy pelo GitHub Actions com OIDC (nenhuma chave de acesso fixa no GitHub).
- App desktop no perfil `hybrid` apontando para o servidor na AWS.

**Pronto quando:** o servidor na AWS recebe uma execução e o runner do app desktop executa o agente de terminal.

---

## Backlog

- Runners hospedados pelo NeuronsAI na AWS (estilo Hostinger): um contêiner isolado por usuário rodando os agentes, inclusive CLIs de terminal com login feito pelo próprio usuário; cobrança.
- Mensagem urgente que interrompe o agente ocupado.
- Adaptador Gemini por API; mais CLIs pré-configuradas.
- Obsidian com escrita, com revisão.
- Importar/exportar grafos; métricas por agente (custo médio, mensagens, duração).
