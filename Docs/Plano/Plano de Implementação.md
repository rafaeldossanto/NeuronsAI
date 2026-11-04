---
tags: [neuronsai, plano, tarefas]
atualizado: 2026-11-04
---

# Plano de Implementação

Decisões e arquitetura em [[NeuronsAI]]. Princípio da ordem: **a comunicação entre agentes
nasce antes do modelador.** Até a T10 tudo roda sem tela, por testes e por um grafo escrito
em JSON. Assim a parte difícil (agentes vivos conversando, terminais, custo, guardas) fica
provada antes de gastar tempo com canvas.

| Fase              | Tarefas | Ao fim dela                                                                              |
| ----------------- | ------- | ---------------------------------------------------------------------------------------- |
| 0 · Fundação      | T01–T05 | Monorepo, esquema do grafo, servidor e banco de pé, fornecedores e terminal provados     |
| 1 · Comunicação   | T06–T10 | Agentes de API e de terminal conversando entre si pelo Hub, com ferramentas e guardas    |
| 2 · Modelador     | T11–T15 | Desenhar, configurar e assistir as conversas ao vivo no canvas                           |
| 3 · Mundo de fora | T16–T18 | Gatilhos externos, templates e landing publicada                                         |
| Distribuição      | T19–T23 | CI em 3 sistemas, banco embutido, app desktop e instaladores para Windows, macOS e Linux |
| Nuvem             | T24–T26 | Protocolo de runner, contas e servidor + banco na AWS                                    |
| Depois            | Backlog | Runners hospedados (estilo Hostinger) e o que não entrou no plano                        |

## Atualização de interface e memórias — 2026-11-04

Implementação aprovada após as entregas do Claude, em `codex/modeler-connections-memories`. Veja [[Interface e memorias aprovadas]] para escopo, verificações e limites atuais. Inclui modelador em nova aba, moldura desktop, conexões por agente, memórias com escrita e integração MCP/runner. O runtime de API OpenAI/Anthropic foi implementado com testes simulados; validação paga de T04/T07 continua pendente. Esta atualização substitui as restrições antigas de memória somente leitura, protocolo revisão 2 e runtime de API indisponível nas descrições históricas abaixo.

### Integração do trabalho do Codex (2026-11-04) e o que ele cobriu

A branch `codex/modeler-connections-memories` foi revisada (achados em [[Interface e memorias aprovadas]], seção "Revisão") e integrada na `dev` com o merge "Merge: interface, conexões e memórias (Codex, revisado)". O que cada tarefa já tem e o que ainda falta:

- **T07 · Runtime de API: parcial.** Feito: `ApiRuntime` em `apps/server/src/agents/api-runtime.ts`, com OpenAI (Responses API) e Anthropic pelos SDKs oficiais; ferramentas `send_message`, `ask`, `reply`, `list_peers`, `finish` mais `list_tools` e `use_tool` (as ferramentas ligadas por `uses`); retentativas com espera crescente feitas pelo SDK; uso gravado em tokens; custo desconhecido (`reportsCost = false`, nunca 0); chave escolhida por nome em `runtime.secretName`. Falta: `ModelProvider`/`ProviderRegistry`/`OpenAICompatibleProvider`; tabela de preços versionada e `UsageCalculator` em US$ (é ela que faz a guarda de custo valer para agentes de API); tradução do esforço por modelo (hoje envia sempre); rodada real do `two-agents.json`/`mixed.json` (só há testes com cliente simulado).
- **T09 · Ferramentas: quase feita.** Feito: Obsidian com `create` e `edit` (sem exclusão), permissão do bloco **e** da ligação, memória por `memoryId` ou `vaultPath`; `list_tools`/`use_tool` no MCP do agente de terminal, no runner (protocolo revisão 3) e no agente de API; cada chamada grava `ToolCalled` (só `nodeId` e `path`). Falta: o teste manual com o cofre do Rafael; ToolCalled para as ferramentas embutidas do Claude Code (Bash, Read...), que não são reportadas; conferir na prática que MCP e HTTP também passam por `use_tool`.
- **T14c · Estados e terminal no web: pouco feita.** Feito: o reducer lê `ToolCalled` (`state.toolCalls`) e a página da execução mostra a seção "Memórias e ferramentas". Já existiam do T14a: `pulses` e `terminals` no reducer. Falta: consumir `AgentStateChanged` (o reducer ainda deduz o estado); desenhar estado e o pulso âmbar sobre o canvas; painel do agente com xterm.js (a dependência não está instalada) usando `state.terminals` e o resumo `replay`; enviar `terminal.input`; linha do tempo única de mensagens e ferramentas; atualizar `live/README.md` (a lista "O que falta" ainda cita estado e `terminal.input`).
- **T15 · Histórico e replay: T15a feita, T15b não iniciada.** A lista com filtros está pronta (ver a T15). Replay no canvas não existe (o reducer puro e idempotente por `seq` serve de base) e vem depois da T14c.
- **T17 · Templates: não iniciada.** Existe a tela "novo projeto" (`new-project-page.tsx`, projeto sem nome e importação de memória), mas sem escolha de template.
- **T18 · Landing: parcial.** Feito: `apps/site` com a landing real, build pelo Vite, CTA "Criar meu projeto" abrindo `/new` e servida em `/` pelo servidor com `NEURONS_LANDING_DIR`. Falta: publicar no domínio, lista de espera com destino, botões de download por sistema, servir com CSP, e trocar os formulários de demonstração por funcionais.
- **Novo no desktop e no servidor:** moldura própria da janela com preload/IPC, chave mestra por `safeStorage`, rotas `/connections` e `/memories`, acesso à IA por agente (assinatura do Claude Code ou chave de API).

## Ordem de execução

- Feito: T01, T02, T03, T05, T06, T08, T09, T10, T11, T12, T19, T20, T21, T24.
- Próxima: T22. Depois: T13–T15 → T25 → T16–T18.
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
    | `obsidian { vaultPath? | memoryId?, readOnly: boolean }` (exatamente uma referência).
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

**Feito (2026-11-02)** — detalhes em `apps/server/README.md` (seções "API REST", "Guardas",
"OpenAPI e cliente tipado" e "Demo da API"). Decisões:

- **Guardas como políticas e serviços, sem mexer no Hub.** `maxMessages` da seta (só mensagens que
  iniciam conversa; `reply` não conta nem é recusado), mensagens por execução (padrão **200**) e
  pingue-pongue entram na cadeia de `MessagePolicy`. Orçamento (`BudgetGuard`) e ociosidade
  (`IdleWatchdog`) escutam o Hub e o Supervisor. Toda parada passa pelo `GuardEnforcer`, que grava
  `GuardTripped` antes de agir. Guarda de execução: `RunFinished { reason: guard_tripped }` e status
  `failed`; guarda de agente: `AgentFailed` e a execução segue.
- **Pingue-pongue: N padrão = 20** mensagens seguidas entre o mesmo par, nos dois sentidos, sem
  terceiro agente, `@human` ou `@trigger` no meio (`NEURONS_PING_PONG_MESSAGES`). Chamadas de
  ferramenta não entram na conta (a regra do plano falava em "sem ferramenta"; a tarefa pediu só
  `finish` e terceiros).
- **Custo desconhecido nunca é 0.** `UsageRecorded.costUsd` é `null` quando o runtime não informa;
  `AgentRuntime.reportsCost` diz se informa (stream-json sim, PTY não); um `GuardWarning` avisa
  uma vez por agente quando há orçamento que isso impede de respeitar; `GET /runs/{id}` separa
  `unknownCostTurns`. **Resolvido na T24:** o `total_cost_usd` do stream-json é **acumulado na
  sessão**, não por turno (ver "Feito" da T24); o runtime passou a reportar a diferença.
- **Descarga do uso: 4 s** (`NEURONS_USAGE_FLUSH_MS`). O `stop()` do stream-json espera o turno em
  andamento acabar (o `result` vem depois do `finish`) e o `RunService` agora para os runtimes
  **antes** de gravar `RunFinished`; o Hub aceita uso de execução que está se encerrando.
- **Cliente: `openapi-typescript` + `openapi-fetch`** em `packages/api-client`. O OpenAPI é montado
  dos contratos zod dos controllers (`@Endpoint`), sem `@nestjs/swagger` (que gira em torno de DTO
  de classe). `pnpm api:generate` regenera; `pnpm api:check` (CI) falha se o commitado ficou velho.
- **Sem login:** escuta em `127.0.0.1`; outro endereço exige `NEURONS_HOST` **e**
  `NEURONS_ALLOW_REMOTE=true`.
- **Demo:** `pnpm --filter @neurons/server demo` usa o `two-terminals.json` (e não o `mixed.json`,
  cujo agente de API ainda não roda) com o CLI de mentira; `-- --real-claude` usa o Claude Code real.
  Uma rodada real (haiku, 2026-11-02, custo ≈ US$ 0,005): os dois agentes conversaram, o `finish`
  veio no meio do turno do Pesquisador e o `UsageRecorded` dele entrou no log **antes** do
  `RunFinished`, que é o que a descarga do uso corrige.
- **Correções no caminho:** resposta a uma pergunta (`ask`) do `@human` agora a resolve; no Windows o
  processo não saía depois de parar um terminal (o node-pty deixava um pipe e uma thread abertos).
- **Adiado:** a coluna `runs.spent_usd` segue sem uso (o gasto é somado do log); apagar grafo com
  versões; limite de mensagens por execução só pela configuração do servidor (não por execução).

---

## Fase 2 · Modelador

Visual já definido pelos estudos: fundo `#F7F7F4`, grafite, pulsos âmbar `#E9A15C`, Manrope,
nada de azul.

### T11 — Esqueleto do web

- Vite + React 19 + TypeScript, Tailwind + shadcn/ui, TanStack Query, roteador.
- Telas: lista de grafos, editor, execuções. Tokens de cor e tipografia da landing.

**Pronto quando:** navega entre as três telas consumindo a API real.

**Feito (2026-11-02)** — como rodar em `apps/web/README.md`.

- Vite 8 + React 19 + TypeScript, Tailwind 4 (tokens em `src/styles.css`, num lugar só, nos nomes
  de variável do shadcn/ui), componentes no estilo shadcn/ui copiados em `src/components/ui`,
  TanStack Query 5 e `react-router` 8 (modo declarativo).
- Telas: `/graphs` (listar e criar), `/graphs/:id` (dados, rascunho, versões e a área reservada do
  canvas da T12) e `/runs`, `/runs/:id` (status, consumo e eventos; atualiza sozinha enquanto roda).
- A API vem do `@neurons/api-client`; em desenvolvimento o Vite faz proxy de `/api` para
  `127.0.0.1:3100`. `import.meta.env` só em `src/config.ts`. Testes com Vitest + Testing Library
  e `fetch` simulado (carregando, vazio, erro e sucesso de cada tela).
- **API:** nenhum endpoint faltou para as três telas. Os eventos ao vivo (`/ws`) vieram na T14a
  (a tela de execução já não faz polling).

### T12 — Canvas e inspetor

- `@xyflow/react` (React Flow) com blocos para agente (ícone diferente para API e terminal),
  ferramenta e gatilho; setas simples ou duplas.
- Inspetor do bloco selecionado: Nome, Papel, Runtime (API: fornecedor e modelo; Terminal: CLI e
  pasta), Esforço, Contexto, ferramentas, orçamento.
- Validação ao vivo com o `validateGraph` da T02. Salvar rascunho, "Publicar versão", desfazer/refazer.

**Pronto quando:** desenhar o `mixed.json` do zero no canvas gera um JSON igual à fixture.

**Feito (2026-11-04)** — detalhes em `apps/web/README.md`.

- `@xyflow/react` 12.12.1 em `apps/web/src/editor/`. O estado é o próprio JSON do grafo num reducer
  puro com histórico (`model.ts`): desfazer/refazer, com digitação e arrasto contando como um passo.
  Tudo que o canvas não edita (`annotations[]`, chaves desconhecidas) volta intacto no salvar.
- Validação ao vivo com `validateGraph`: erro no bloco, no inspetor e numa lista clicável; "Publicar
  versão" só habilita sem erros e salva o rascunho pendente antes de chamar a API.
- Teste da fixture (`model.test.ts`): monta o `mixed.json` do zero com as mesmas ações da tela
  (adicionar, arrastar, digitar no inspetor, ligar) e compara com `toEqual`, posições incluídas.
- CSP do desktop: sem mudança; o servidor já libera `style-src 'unsafe-inline'` e o canvas rodou sob
  ela, sem violações (`script-src` segue só `'self'`).
- **API:** nada faltou. A seta do gatilho é o campo `target` (não há ligação); duas setas `talk`
  opostas (A→B e B→A) são válidas e aparecem sobrepostas — a seta dupla é o `bidirectional`.

### T13 — Camada livre

- Retângulo, elipse, seta livre, texto, nota e grupo no mesmo canvas, com traço de desenho à mão
  (`roughjs`). Salvos em `annotations[]`, ignorados pelo servidor.

**Pronto quando:** anotar um grafo, salvar, reabrir e ver tudo no lugar.

**Feito (2026-11-04)** — detalhes em `apps/web/README.md`.

- `roughjs` 4.6.6, só o gerador: `toPaths` devolve o `d` dos traços e o React desenha `<path>`; sem DOM
  manual, sem eval, sem script inline (a CSP do servidor segue `script-src 'self'`). A semente vem do
  `id`, então o traço não treme entre renderizações.
- As anotações entram no **mesmo reducer e no mesmo histórico** da T12 (`model.ts`), com as ações
  `addAnnotation`, `setAnnotationField`, `resizeAnnotation`, `moveNodes` (agora também move
  anotações) e `remove` (com `annotationIds`). Arrastar, redimensionar e digitar viram um passo só.
  Mover um grupo move os membros (blocos e anotações, grupos aninhados incluídos); apagar um item o
  tira dos grupos. Não há segundo histórico.
- No canvas são nós do React Flow com `zIndex` negativo (grupo -2, demais -1): ficam abaixo dos blocos
  e das setas. Grupo e seta só pegam o mouse no traço e no nome, então nunca atrapalham ligar ou
  selecionar blocos. Tipos `free-*`, porque o React Flow estiliza um tipo embutido chamado `group`.
- Barra: selecionar, retângulo, elipse, seta livre, texto, nota e grupo (atalhos V R O A T N G, Esc volta
  a selecionar). Cada ferramenta desenha arrastando sobre o canvas; o grupo envolve o que couber
  inteiro nele. Cor, preenchimento, texto e fonte no inspetor.
- **Schema:** o `annotationSchema` já tinha tudo (`size`, `points`, `text`, `style`, `memberIds`), sem
  mudança. Só a regra `group-members` foi afrouxada, de forma compatível: `memberIds` aceita também ids
  de anotações (menos o do próprio grupo), com testes.
- Testes: reducer (criar, mover, redimensionar, texto, apagar, desfazer/refazer, grupo carrega membros)
  e a tela (desenhar as seis, salvar com `fetch` simulado, reabrir com o rascunho salvo, desfazer e
  refazer). Conferido no navegador com servidor (PGlite) + Vite.

### T14 — Execução ao vivo

- Abrir uma execução sobre o desenho da versão em que ela roda.
- Estado de cada agente no bloco (subindo, ocupado, ocioso, esperando resposta, falhou) e
  **pulso âmbar percorrendo a seta** a cada mensagem, no sentido de quem mandou.
- Clicar num agente abre o painel dele: a conversa (agente de API) ou o **terminal ao vivo**
  com xterm.js (agente de terminal), com campo para você escrever para ele.
- Linha do tempo de mensagens e chamadas de ferramenta, custo por agente e total, botão de parar.

**Pronto quando:** rodar o `mixed.json` com modelos reais e acompanhar tudo pela tela, inclusive
digitar no terminal do Claude Code.

Dividida em três partes. **T14a (feita): dados ao vivo**, sem canvas, em `apps/web/src/live/`
(contrato em `live/README.md`):

- Cliente do `/ws` na mesma origem (proxy `ws: true` no Vite). O histórico vem do próprio
  `subscribe { fromSeq: 1 }`: um canal só, sem costurar REST e WebSocket. Reconecta com backoff
  exponencial e `fromSeq = último + 1`; descarta duplicatas e atrasados, e um buraco no `seq`
  força a reconexão.
- `reduceRunEvent` puro e idempotente por `seq` (a T15 reaproveita para o replay); custo
  desconhecido nunca vira 0. Agentes são chaveados pelo **nome** (é o que o servidor grava).
- `useRunLive(runId)` e a tela `/runs/:id` sem polling: status, agentes, custo, mensagens,
  guardas, Parar e mensagem como `@human`.

**T14b (feita, 2026-11-04): eventos de estado, ferramenta e terminal no servidor.** As quatro
lacunas que a T14a apontou; detalhes e formatos em `apps/server/README.md` (seção "WebSocket").
Decisões:

- **`AgentStateChanged { agent, state, reason? }`** no log, com `state` em
  `starting | busy | idle | waiting_reply | failed | finished`. O runtime diz se o agente trabalha
  (PTY: `UserPromptSubmit` = `busy`, `Stop` = `idle`; stream-json: entrega e `result`); o **Hub**
  conta os `ask` abertos de cada agente (`Hub.openAsksOf`) e `waiting_reply` dura enquanto houver
  algum, então com dois abertos a primeira resposta não volta a `busy`; o Supervisor escreve
  `starting` (na mesma transação de `AgentStarted`), `failed` (com o motivo, junto de `AgentFailed`)
  e `finished` (ao parar a execução, antes de `RunFinished`). Só grava quando o estado muda, em
  fila por agente para manter a ordem. O estado vem do **servidor** e não do que o runtime diz de
  `waiting_reply`, então vale igual para qualquer runtime (o de API da T07 também). No perfil
  `hybrid` o estado do runtime já chegava pelo `agent.state`: nada novo no protocolo para isso.
- **`ToolCalled { tool, inputSummary, durationMs, ok, errorCode }`** gravado por
  `Hub.reportToolCall`, alcançado por `AgentCommunication.reportToolCall` (contrato novo em
  `@neurons/agent-runtimes`, `ToolCallReport`, estruturalmente igual ao `ToolCallRecord` de
  `@neurons/tools`) e, no runner, pelo `call` `report_tool_call`. O resumo nunca leva segredo: o
  `{{secret:NOME}}` do que o agente mandou aparece só como o nome, chaves sensíveis viram
  `[oculto]`, textos e o resumo são cortados, e os valores que a chamada resolveu são removidos
  como segunda trava (testado explicitamente). **Falta ligar quem chama:** nenhum runtime usa
  ferramentas de `@neurons/tools` hoje (o runtime de API é a T07 e a configuração MCP da sessão
  de terminal é da T09); as ferramentas do Hub continuam aparecendo como mensagens e como o fim,
  e as ferramentas embutidas do Claude Code (Bash, Read...) não são reportadas.
- **`terminal.input { runId, agent, data }` no `/ws`**, nos perfis `local` e `hybrid` (neste, o
  `agent.input` que já existia no protocolo). Valida: execução em andamento, agente do grafo,
  terminal PTY, terminal já aberto; limita o tamanho (`NEURONS_TERMINAL_INPUT_MAX_CHARS`, 4096) e
  a taxa por conexão (`NEURONS_TERMINAL_INPUT_PER_SEC`, 100); recusa com `error { code, message }`
  e não responde quando aceita. **O texto digitado não é guardado** (nem em log, nem em evento,
  nem na mensagem de erro); também não há evento "alguém digitou" (uma tecla por mensagem encheria
  o log). Sem conexão com o runner, recusa com `terminal_unavailable` em vez de perder a tecla em
  silêncio.
- **Protocolo do runner: revisão 2 dentro da versão 1** (`PROTOCOL_REVISION`). Só o `call`
  `report_tool_call` é novo; cada ponta anuncia a sua revisão no `register`/`registered` (campo
  opcional, ausente = 1) e só usa o recurso novo quando a outra o tem. Servidor antigo + runner
  novo e o contrário continuam funcionando.
- **Saída do terminal na reconexão: o resumo (`replay: true`, ~200 mil caracteres por terminal)
  basta para o xterm.js** e ficou como está: a TUI repinta a tela, e o resumo inclui o que passou
  durante a queda. Só uniformizei o runner remoto para guardar chunks inteiros (como o local),
  em vez de cortar a string no meio. Gravar a saída no log foi descartado (centenas de KB por
  minuto). Lacuna conhecida: no `hybrid`, o que o runner imprime com a conexão runner ↔ servidor
  caída não chega ao servidor.
- **Demo** (`pnpm --filter @neurons/server demo`, nos dois perfis) agora mostra os eventos novos
  e digita no terminal do Pesquisador pelo `/ws` (e confere a recusa `not_a_terminal` no
  Revisor). Sem rodada com o Claude Code real (cota).

**T14c (falta):** no web, desenhar sobre o canvas da T12 o estado de cada agente (consumindo
`AgentStateChanged`, que substitui a dedução do `reduceRunEvent`) e o pulso âmbar nas setas
(`state.pulses`), o painel do agente com xterm.js (`state.terminals`, trocando o conteúdo pelo
resumo `replay`, e `terminal.input` para digitar), e a linha do tempo de mensagens e ferramentas
(`ToolCalled`). Atualizar o `live/README.md` e o reducer para os eventos novos.

### T15 — Histórico e replay

Dividida em duas:

- **T15a · Lista de execuções com filtros: feita.** `GET /runs` filtra por `status`, `graphId`, `graphVersionId`, faixa de custo (`minCostUsd`/`maxCostUsd`, sobre o custo conhecido) e início (`from`/`to`), ordena (`sort`/`order`) e pagina por `offset` (`{ items, total, limit, offset }`); cada item traz grafo, versão, status, datas, `durationMs`, `costUsd` e `unknownCostTurns`, com o custo agregado do log em uma consulta (sem N+1) e índices na migration `0004`. Custo desconhecido nunca vira 0 e o filtro compara a parte conhecida (detalhes no README do servidor). A tela `/runs` tem a barra de filtros, a tabela, a paginação e o estado vazio, com tudo no endereço.
- **T15b · Replay no canvas: falta (depois da T14c).** Replay das mensagens de uma execução terminada no canvas, com controle de velocidade, reaproveitando o `reduceRunEvent`. Pode ganhar um botão "Replay" na linha da tabela e a ordenação por duração, se quiserem.

**Pronto quando (T15a):** com execuções de grafos e versões diferentes, cada filtro e as combinações dão o conjunto certo, na API e na tela (testes de integração nos dois bancos e da tela).
**Pronto quando (T15b):** o replay de uma execução mostra as mensagens na ordem certa e nas setas certas.

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
- Trava de instância única (`app.requestSingleInstanceLock()`) e trava por arquivo na pasta de dados do PGlite: hoje dois processos podem abrir a mesma pasta e corromper o banco.

**Pronto quando:** o app abre no Windows com o modelador e roda uma execução com agente de terminal; o build local (`electron-builder --dir`) passa nos três sistemas pelo CI.

**Feito (2026-11-04)** — como rodar e empacotar em `apps/desktop/README.md`. Decisões:

- **Electron 45.2.2 e electron-builder 26.18.0**, versões exatas. O servidor roda no processo principal (perfil `local`, runner embutido) por `@neurons/server` (novo ponto de entrada `embed`, sem subir nada ao importar), escutando em `127.0.0.1` na porta 0 (o sistema escolhe, sem janela entre "está livre?" e escutar).
- **Uma origem só.** O próprio servidor serve o `apps/web/dist` (`createApp(config, { ui })`): a interface em `/`, a API em `/api` (o prefixo é tirado por `rewriteUrl`, sem mexer em controller) e o WebSocket em `/ws`. Sem preload, sem CORS e sem segundo servidor.
- **Segurança:** `contextIsolation`, `sandbox`, sem `nodeIntegration`, sem preload; CSP restritiva enviada pelo servidor; todo pedido da janela que não vá ao servidor local é cancelado, permissões negadas, `window.open` e navegação para fora bloqueados (links `http(s)` abrem no navegador do sistema).
- **Diferenças por sistema sem duplicar:** pasta de dados e CLI do Claude vêm da config do servidor (`data-dir.ts`, `claude-binary.ts`); árvore de processos de `process-tree.ts`; só o menu e os atalhos (`menu.ts`) são do desktop. O `userData` do Electron fica em `<pasta de dados>/electron`.
- **O MCP `neurons` roda com `ELECTRON_RUN_AS_NODE=1`** (`mcpServer.env`, novo): sem isso o CLI do Claude abriria outra janela do app em vez do servidor MCP.
- **Duas travas.** Instância única do Electron (`requestSingleInstanceLock`) e `DirectoryLock` (`<pasta>/db.lock` com o PID, criado de forma atômica; trava de processo morto é retomada), usada pelo `PgliteDatabaseProvider`: vale para o servidor avulso também. Falhas ao subir (`abortOnError: false`) viram mensagem para o usuário, não saída silenciosa.
- **Config própria:** `NEURONS_DESKTOP_CLAUDE_COMMAND`/`_ARGS` (CLI de mentira para testes) em `apps/desktop/src/config.ts`, o único arquivo do pacote que lê o ambiente (exceção no lint, como `runner/src/config.ts`).
- **Empacotamento:** `asar: false` por ora (o CLI e o node-pty leem arquivos do disco); o `--dir` não gera instalador. `scripts/smoke.mjs` abre o app (do código-fonte ou empacotado) com o CLI de mentira e roda o `two-terminals.json`; roda no CI do Windows.
- **Ícone provisório** (neurônio âmbar sobre grafite) gerado por `scripts/make-icon.mjs`; o definitivo substitui `build/icon.png`.

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

**Pronto quando:** os instaladores abrem sem aviso no macOS e no Windows.

---

## Fase de nuvem

### T24 — Protocolo de runner

- `packages/runner-protocol`: mensagens versionadas em zod (registrar, heartbeat, iniciar agente, entregar mensagem, confirmar, mudança de estado, saída do terminal, parar agente).
- `RemoteAgentRuntime` no servidor, implementando a mesma `AgentRuntime`, e o lado runner que hospeda os runtimes de terminal e stream-json da T08.
- Runner embutido no mesmo processo (perfil `local`) e runner separado conectando por WebSocket de saída, com token por runner (perfil `hybrid`).
- Reconexão sem perder mensagem (o Hub já reentrega o que não teve confirmação).

**Pronto quando:** a mesma execução do `mixed.json` roda com o runner no mesmo processo e com o runner em outro processo, mudando só a configuração.

**Feito (2026-11-02)** — detalhes em `packages/runner-protocol/README.md`, `packages/runner/README.md` e `apps/server/README.md` (seção "Runners e perfis"). Decisões:

- **Prova com o `two-terminals.json`, não com o `mixed.json`** (o agente de API, T07, ficou para o fim por ter custo). `pnpm --filter @neurons/server demo` roda a execução com o runner embutido (perfil `local`); `demo -- --profile=hybrid` roda a mesma execução com o runner **em outro processo**, conectado por WebSocket. Mesmos 11 eventos, mesmo resultado; só o perfil muda. O `mixed.json` entra quando a T07 existir.
- **Protocolo v1, em zod** (`packages/runner-protocol`, fonte única). Todo frame é JSON com `v` e `type`; um `v` desconhecido é recusado antes de qualquer outra leitura. Runner → servidor: `register`, `heartbeat`, `agent.state`, `agent.output`, `call`, `response`. Servidor → runner: `registered`, `reject`, `heartbeat`, `agent.start`, `agent.deliver`, `agent.stop`, `agent.input`, `call.result`. Além dos oito itens do plano, entraram `call`/`call.result` (as ferramentas do agente — `send_message`, `ask`, `reply`, `list_peers`, `finish`, `report_usage` — precisam chegar ao Hub, que fica no servidor) e `agent.input` (o usuário digita no terminal do agente). `AgentCommunication.listPeers` passou a poder devolver uma promessa.
- **Reconexão sem perder mensagem.** Tudo que cruza a conexão é idempotente por id: o servidor reenvia o pedido que o runner não respondeu (`agent.start`, `agent.deliver`, `agent.stop`), o runner responde a repetição com o que já fez (um `message.id` já entregue não é entregue de novo) e o runner reenvia o `call` sem resultado (o servidor responde com o desfecho da primeira execução, sem enviar a mensagem duas vezes; guarda os últimos 2000). O `register` de cada conexão lista os agentes vivos do runner: o servidor atualiza os estados perdidos (um `idle` perdido volta a acionar a entrega da caixa de entrada) e responde com `keep`, a lista que ainda quer; o runner para os demais (órfãos de um servidor que reiniciou).
- **Carência de 60 s** (`NEURONS_RUNNER_GRACE_SEC`): a conexão que cai não falha os agentes; só se o runner não voltar nesse prazo é que viram `AgentFailed` ("não voltou"). Um runner que volta sem o agente (reiniciou) também o falha ("perdeu o agente"). Heartbeat nos dois sentidos a cada 15 s; 3 batidas perdidas fecham a conexão. O runner reconecta com espera crescente (0,5 s até 15 s) e desiste só se o servidor o recusar.
- **Perfis** (`NEURONS_PROFILE`): `local` (padrão) hospeda os agentes num **runner embutido** que fala o mesmo protocolo por um canal em memória; `hybrid` não hospeda nada e aceita runners em `/runner`; `hosted` se comporta como `hybrid` até a T26. Um agente novo vai ao runner conectado com menos agentes, esperando até 30 s por um (`NEURONS_RUNNER_WAIT_SEC`) antes de falhar com "Nenhum runner conectado".
- **Token por runner.** Emitido pelo servidor (`pnpm --filter @neurons/server runner:token create <nome>`), mostrado **uma única vez** e guardado só como SHA-256 (tabela `runners`, migration `0003_runners`; o token é longo e aleatório, 256 bits, `nrn_...`, então hash rápido basta). Vai no cabeçalho `Authorization: Bearer` do upgrade do WebSocket, nunca no endereço, em log ou em frame. Revogar (`runner:token revoke <nome>`) recusa o runner e derruba o conectado na próxima checagem (a cada batida). O runner se recusa a mandar o token em `ws://` para outra máquina (precisa de `wss://` ou `NEURONS_RUNNER_ALLOW_INSECURE=true`). Sem REST de emissão por enquanto: a API ainda não tem login, e emitir token por ela entregaria o acesso a qualquer um que alcance a porta; a T25 vincula o runner a uma conta.
- **Código.** `packages/runner-protocol` (frames, codec, canais, canal em memória), `packages/runner` (`RunnerHost`, que hospeda os runtimes da T08; `RunnerConnection`, o cliente WebSocket que reconecta; programa `neurons-runner`) e, no servidor, `src/runners/` (`RemoteAgentRuntime`, `RunnerLink`, `RunnerRegistry`, `RunnerGateway`, `EmbeddedRunner`, tokens). O Hub e o Supervisor não mudaram: o `RemoteAgentRuntime` implementa a mesma `AgentRuntime`.
- **`total_cost_usd` é acumulado na sessão** (resposta à pergunta da T10). Medido com o Claude Code 2.1.309 e Haiku, em sessões stream-json: com turnos de 586, 4 e 4 tokens de saída os totais foram 0,00099 → 0,00155 → 0,00200 (crescem mesmo com um turno minúsculo no meio) e `modelUsage` soma os tokens dos turnos (586 → 590 → 594), enquanto `usage` é por turno. Antes o orçamento contava o custo em dobro (ou mais) a cada turno. O `ClaudeStreamJsonRuntime` agora reporta a diferença para o total anterior (`costOfTurn`); o CLI falso passou a acumular como o real. Custo das duas rodadas reais: ≈ US$ 0,004 no total. O `--max-budget-usd` do CLI compara com esse mesmo total acumulado, então continua coerente.
- **Adiado:** a demo real (`--real-claude`) no perfil `hybrid` (a cota das rodadas reais foi usada na medição do custo); REST/UI para emitir e revogar tokens (T25); escolher o runner de cada agente no grafo (hoje o menos carregado); reenviar a saída do terminal perdida durante uma queda (o servidor guarda só o que chegou); o runtime de API (T07) rodando num runner.

### T25 — Contas e multiusuário

- **Login com Google** (OpenID Connect com PKCE), atrás de uma interface de provedor de identidade para dar para acrescentar outros depois. No app desktop, o login abre o **navegador do sistema** e volta para o app por deep link `neuronsai://` (ou endereço local de retorno) — nunca numa janela embutida, que o Google bloqueia.
- Sessão do NeuronsAI com tokens próprios (acesso curto + renovação rotativa); no app desktop ficam no cofre do sistema (`safeStorage` do Electron: Keychain, Credential Manager, libsecret).
- Credencial do provedor (client secret do Google) só na config/Secrets Manager, nunca no código.
- Organizações e papéis; grafos, execuções, runners e segredos isolados por organização.
- **Depende do Rafael:** criar o OAuth client no Google Cloud (grátis).
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
- Sincronização contínua de cofres e revisão humana opcional da escrita (criar/editar com permissão já implementado).
- Importar/exportar grafos; métricas por agente (custo médio, mensagens, duração).
