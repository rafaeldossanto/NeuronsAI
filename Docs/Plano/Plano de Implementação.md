---
tags: [neuronsai, plano, tarefas]
atualizado: 2026-11-06
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

## Estado consolidado

Atualizado em **2026-11-09**. Esta seção é a referência de andamento. As seções por tarefa preservam critérios de aceite,
decisões e resultados datados; uma entrega de código não equivale à aceitação com serviços
reais nem à publicação. As notas de interface/memórias e T25 mantêm o histórico das entregas.

Base conferida: `25733af` (merge da dev na main, PR #13). O [CI desse commit](https://github.com/rafaeldossanto/NeuronsAI/actions/runs/42301122748) passou nos oito jobs: checagens e empacotamento desktop nos três sistemas, integração com Postgres e gitleaks. O smoke do app empacotado no Windows usa CLI simulada; isso não substitui Google, modelos ou aceitação manual reais.

| Tarefas | Implementação e validação disponíveis | O que ainda falta |
| --- | --- | --- |
| T01–T03, T05–T06, T10–T13, T15, T19–T20 | Fundação, Hub, guardas, editor e anotações, histórico/replay, CI e PGlite integrados. T15 inclui total de eventos e ordenação por duração. | Nenhuma implementação dessas frentes está aguardando início; os fluxos reais restantes estão nas linhas abaixo. |
| T04 / T07 | `ApiRuntime` OpenAI Responses/Anthropic com SDKs oficiais, comunicação, ferramentas e tokens, testado com clientes simulados. | Spike real e aceitação de `two-agents.json` e `mixed.json`. Adaptadores, registro, compatível com OpenAI, preços/cálculo e tradução de esforço foram implementados na continuação local; catálogo deliberadamente limitado e transporte validado com fetch simulado. |
| T08 / T24 | Claude Code em PTY e stream-json, runner embutido ou separado, protocolo v1 revisão 5, reconexão, resize e snapshot do terminal. Há provas reais anteriores de terminal/comunicação. | Aceitação real integrada no perfil hybrid e do fluxo misto com API. Codex, Gemini e `custom` constam do esquema, mas não executam; ficam como expansão do backlog. |
| T09 | MCP, HTTP e Obsidian com leitura/escrita autorizada, `list_tools`/`use_tool` e `ToolCalled` integrados. Em 05/11 houve leitura do cofre do Rafael, escrita em cópia e HTTP/MCP stdio por `use_tool`; o cofre original foi preservado. | Hooks nativos implementados na continuação local e validados com eventos simulados; falta aceitação com a CLI real. |
| T14 | Canvas ao vivo, estado, mensagens, linha do tempo, entrada e redimensionamento do terminal implementados. | Aceitação pela interface com Claude Code real, digitação/resize e agentes de API reais. |
| T16a | Webhook assinado e agenda implementados. Demonstração no servidor validou assinatura, replay e cron em dois minutos consecutivos. Configuração da porta já existe no desktop. | Conferência manual da configuração e do cron no app desktop instalado. |
| T16b | Gatilho e ferramenta de resposta do WhatsApp implementados e provados contra uma Meta simulada (11/11). | Aceitação real: número de teste da Meta, passo a passo no README do servidor. |
| T17 | Três templates, prévias e criação de rascunhos integrados; criação/reabertura/publicação explícita e pesquisa/revisor validados com CLI simulada. | Executar os dois templates que usam API com chaves reais, junto da T07. |
| T18 | Landing, downloads por sistema, instruções, CSP em meta e workflow manual do Pages implementados; formulários fictícios removidos. | Hospedagem e URL do modelador, publicação e primeira release. Lista de espera depende de destino e permanece desligada. Assets e headers da landing junto ao NestJS foram tratados na continuação local. |
| T21 | Electron local com PGlite, IPC isolado, configurações de gatilhos e encerramento com limites de tempo. | Ordem de fechamento e clientes HTTP pendentes corrigidos nesta continuação; concluir aceitação real do app e conferir estabilidade nos demais sistemas. A conexão remota da T25 não inicia automaticamente um runner local. |
| T22 | Pipeline de instaladores, checksums e atualizador implementados; atualização local Windows 0.0.1 → 0.0.2 registrada. | Primeira release pública e aceitação de instalação/atualização nos sistemas-alvo. macOS sem assinatura e Linux deb usam download manual. |
| T25 | Contas, Google OIDC, sessões, organizações, convites, isolamento, runners, desktop remoto, adoção de dados e cotas revisados e integrados em dev/main. | OAuth client e origem/retorno reais; aceitação web/Electron com Google, renovação e reinício/cofre nos três sistemas. |
| T23 / T26 | Assinatura de código e infraestrutura AWS ainda não implementadas. | Certificados/notarização; CDK, ECS/RDS, persistência, segredos, domínio/TLS e deploy. Mantidas para a etapa final com custo. |

**Limite de custo:** o terminal PTY não informa custo em USD; APIs agora estimam custo somente para os modelos do catálogo versionado. Fora dele, o consumo
desconhecido permanece desconhecido, nunca zero; `budgetUsd` não garante teto nesses runtimes.
O stream-json informa custo por diferença do total acumulado da sessão.

## Aceitação real de 11/11/2026

Rodada com a CLI real (Claude Code 2.1.321, assinatura Pro, Haiku, sem chave de API; cinco execuções, todas curtas, o custo em USD do PTY não é informado). Resultado: terminal pela tela (digitar, redimensionar, recarregar) **passou**; `ToolCalled` dos hooks (T09) **passou**; `hybrid` com runner em outro processo e quedas de conexão **passou** depois de uma correção (resize durante a queda); modos de `--permission-mode` **passaram**; o template "Pesquisa com revisor" foi criado e publicado pela tela mas **não rodado** (teto de execuções). Achado extra: a CLI do app desktop não era encontrada neste Windows. **Fechamento lento:** causa achada e corrigida (parar um agente ainda em boot esperava o boot, até 60 s). Detalhes nas seções T10, T15, T18, T22 e T25 abaixo.

## Continuação local de 06/11/2026

Implementação posterior à consolidação acima: [[Entrega local sem custo]]. Foram entregues a ordem de encerramento da T21, os adaptadores/registro/cálculo de uso da T07, convites e permissões por rota da T25, telemetria nativa da T09, seleção de runner e snapshot de reconexão da T24, e assets isolados da landing na T18. A T22 segue com preparação e validação local; publicação e aceitação nos demais sistemas continuam separadas. As correções de segurança estão em [[Seguranca]].

**Streaming token por token (decidido pelo Rafael em 2026-11-14).** A execução ao vivo mostra o texto de cada agente de API e de stream-json crescendo enquanto o modelo gera: `respond(..., { onDelta })` nos provedores (SSE, sem mudar o resultado final), `--include-partial-messages` no stream-json, evento passageiro `AgentOutputDelta` (fora do log, agrupado a cada ~50 ms), frame `agent.delta` no runner (**revisão 6** do protocolo, compatível nos dois sentidos) e rascunho na tela. Validado só com provedores e CLI simulados; falta a aceitação real (chave de API e uma rodada stream-json com Haiku, para conferir o formato dos eventos parciais).

## Revisão de 09/11/2026 do trabalho do Codex

O trabalho de 06–07/11 estava sem commit na pasta principal; foi salvo e revisado de forma independente antes de entrar na `dev`. Checagens reais: formatação, lint, tipos e build em 48 tarefas do Turborepo, `api:check`, 214 testes de integração com Postgres (migration `0013` incluída) e o smoke do pacote Windows, todos verdes; contagens em [[Seguranca]]. Achados corrigidos: (1) a checagem de Host/Origin bloqueava quem acessa por IP um servidor aberto com `NEURONS_ALLOW_REMOTE`, agora IP literal vale nesse modo; (2) a CSP da landing impedia a consulta à última versão no GitHub; (3) o `openai-compatible` não tinha teste da guarda de saída, agora tem; (4) as permissões por rota não tinham uma lista fixa, agora o teste `route-permissions.test.ts` as enumera. Rota de escrita sem declaração cai em `write` (membro), não em negação: é uma escolha, registrada no teste.

## Próximos passos

1. **Beta local:** repetir a aceitação real após corrigir a ordem de encerramento; aceitar o fluxo completo no modelador com Claude Code real, digitação/resize, memória e gatilhos; preparar a primeira release e conferir instalação/atualização. Manter separados testes com CLI simulada e aceitação real.
2. **Contas e híbrido:** configurar o OAuth client Google (sem custo de API de modelo), origem e retorno; aceitar login/renovação/reabertura nos três sistemas e execução com runner separado. A integração automática do runner ao desktop é uma evolução de experiência, não uma entrega já pronta da T25.
3. **Publicação e integração externa:** decidir hospedagem da landing/URL do modelador e destino opcional da lista; publicar quando autorizado. T16b depende do número de teste da Meta e pode usar túnel até a T26.
4. **Por último, preservando a decisão de custos:** provas pagas de T04/T07, AWS (T26) e assinatura de código (T23). A abstração de provedores e os testes simulados foram entregues; expandir o catálogo e executar a aceitação real são etapas distintas.

Antes da exposição pública, configurar as listas de cadastro/primeiro proprietário e `trustProxy`
no balanceador; ver as pendências operacionais da T25. SSRF, convites, publicação de segredos
por admin e concorrência das cotas já têm implementação, não devem ser reabertos como ausentes.

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
- Ligação: `{ id, from, to, kind: "talk" | "uses", bidirectional, maxMessages?, readOnly? }`.
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

- `apps/server` em NestJS 12 com adaptador Fastify. Módulos de grafos, execuções, Hub,
  agentes, contas, conexões, memórias, runners, gatilhos, segredos e infraestrutura compartilhada.
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

**Pendente.** O runtime OpenAI/Anthropic já existe na T07 com clientes simulados; o spike
comparativo com chaves reais e a nota de fornecedores abaixo ainda não foram entregues.

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

- Script em `spikes/terminal/` que, com `node-pty`:
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

**Implementação local ampliada em 06–07/11/2026.** `ApiRuntime` mantém o ciclo e as ferramentas; `packages/providers` agora concentra os adaptadores oficiais, o registro de provedores e o cliente compatível com OpenAI. Sessões mantêm mensagens e resultados correlacionados; os eventos são normalizados por resposta completa. A tabela versionada calcula estimativas somente para modelos conhecidos, preservando custo desconhecido quando falta preço ou uso. A tradução de esforço omite opções desconhecidas ou sem suporte. Contratos dos SDKs foram testados com fetch interceptado; aceitação paga permanece pendente da T04/T07.

- Sessões `ModelProvider.createSession`, `ProviderRegistry` e `runModelTurn(): AsyncIterable<ModelEvent>` com tipos próprios
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
  `list_peers`, `finish`, `list_tools` e `use_tool`, autenticado por um token por agente e por execução, falando com o Hub
  por HTTP local.
- `ClaudeTerminalRuntime` (resultado do spike T05, `Docs/Spikes/Terminal.md`): `node-pty` 1.1.0 (binário pronto para Windows, sem compilador) + `@xterm/headless` para ler a tela; **fim de turno pelo hook `Stop`** do Claude Code configurado na sessão, com o rodapé da TUI (`esc to interrupt` = ocupado, `? for shortcuts` = livre) e 1,5 s de silêncio só como confirmação; **injeção** = digitar o texto, esperar o eco na tela + 400 ms, Enter, confirmar pelo hook `UserPromptSubmit`; saída transmitida ao WebSocket.
- `ClaudeStreamJsonRuntime`: segundo runtime, para agentes sem tela, com `claude -p --input-format stream-json --output-format stream-json` como sessão persistente (fim de turno, uso e custo explícitos; turno quente ~5 s no spike). A opção já existe no bloco: `runtime.mode` aceita `pty` (padrão) e `stream-json`.
- Os dois implementam a mesma `AgentRuntime` (injetar, ocioso/ocupado, saída, encerrar).
- Encerramento da árvore de processos por sistema; no Windows, `taskkill /T /F`. A reconexão do runner trata agentes órfãos. Prompt multilinha já usa bracketed paste e tem teste com CLI simulada; a conferência da CLI real no modelador continua na T14. Mudanças de versão da CLI exigem conferir os textos de tela usados pela detecção do PTY.
- Esforço e modelo passados por flag/config da CLI quando ela tiver; senão, ignorados com aviso.

**Pronto quando:** `mixed.json`: um agente de API manda uma tarefa ao Claude Code no terminal,
o Claude Code pergunta algo com `ask`, recebe a resposta e avisa com `send_message` ao terminar.

### T09 — Ferramentas: MCP, HTTP e Obsidian

**Implementada e com validação manual controlada em 2026-11-05.** Leitura de nota do cofre
do Rafael, criação/edição em cópia temporária e HTTP/MCP stdio por `use_tool` produziram seis
`ToolCalled` bem-sucedidos; a nota original preservou o hash. Detalhes em
[[T25 - Contas e isolamento]], seção "Outras validações desta leva". A escrita direta no
cofre original e o registro de ferramentas nativas da CLI não foram validados.

- Cliente MCP (SDK oficial), stdio e HTTP; só as ferramentas de `allowedTools` chegam ao agente.
- Ferramenta HTTP valida o corpo pelo `bodySchema`; segredos por nome (`{{secret:X}}`), nunca no grafo.
- Obsidian: busca, leitura e links, com criação/edição quando bloco e ligação permitem escrita;
  sem exclusão. A origem é `memoryId` ou `vaultPath`, com proteção de caminhos e pastas reservadas.
- Agentes de API e terminal acessam as ferramentas autorizadas por `list_tools`/`use_tool`;
  o terminal passa pelo MCP `neurons` e pelo runner. Em contexto de organização, MCP stdio
  no servidor compartilhado é recusado; MCP HTTP continua disponível.
- Cada chamada grava `ToolCalled` (ferramenta, entrada resumida, duração, erro).

**Pronto quando:** um agente responde uma pergunta lendo um cofre do Rafael (teste manual) e os
testes cobrem a fuga de diretório.

**Aceitação real com a CLI (2026-11-11).** Claude Code 2.1.321 real (CLI do app desktop, assinatura Pro, modelo Haiku 5.5, sem chave de API), servidor com PGlite e a interface servida por ele, no navegador do app. Um agente PTY recebeu "leia notas.txt com a ferramenta Read e chame finish": o log trouxe `ToolCalled` de `Read` (e de `ToolSearch`, a ferramenta embutida que carrega o `finish`) com `[argumentos omitidos]`, **sem** argumentos nem resultado e **sem** uma segunda linha para o MCP `neurons`; o `finish` encerrou a execução com a linha do arquivo. Repetido no perfil `hybrid` (mesmo resultado). O `PostToolUseFailure` não foi exercitado: um `sleep 45` do Bash foi barrado pela própria CLI antes de rodar (sem hook, sem `ToolCalled`; o agente chamou `finish` explicando). **Passou.** Custo: o PTY não informa USD (a tela mostra "custo desconhecido"); foram turnos curtos de Haiku.

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
- **Modo local sem login:** escuta em `127.0.0.1`; outro endereço exige `NEURONS_HOST` **e**
  `NEURONS_ALLOW_REMOTE=true`. A T25 acrescentou contas opcionais em hybrid/hosted;
  liberar o endereço remoto, sozinho, não ativa autenticação.
- **Demo:** `pnpm --filter @neurons/server demo` usa o `two-terminals.json` com o CLI de mentira;
  `-- --real-claude` usa o Claude Code real. O runtime de API já existe, mas a aceitação real
  do `mixed.json` permanece na T04/T07.
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

- `@xyflow/react` 12.12.1 em `apps/web/src/graphs/editor/`. O estado é o próprio JSON do grafo num reducer
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

**Feito (2026-11-04)** — as três partes (T14a, T14b e T14c) estão abaixo; a rodada com o Claude
Code real, que o "Pronto quando" cita, ainda não foi feita (cota).

Dividida em três partes. **T14a (feita): dados ao vivo**, sem canvas, em `apps/web/src/runs/live/`
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
  como segunda trava (testado explicitamente). **Integração concluída depois na T09:** agentes
  de API e terminal usam `list_tools`/`use_tool`; `GraphToolsService` executa as ferramentas e
  registra `ToolCalled`, com resumo de `nodeId` e `path`, sem conteúdo de nota. As ferramentas
  do Hub aparecem como mensagens/fim; as ferramentas nativas do Claude Code (Bash, Read...)
  continuam sem esse registro.
- **`terminal.input { runId, agent, data }` no `/ws`**, nos perfis `local` e `hybrid` (neste, o
  `agent.input` que já existia no protocolo). Valida: execução em andamento, agente do grafo,
  terminal PTY, terminal já aberto; limita o tamanho (`NEURONS_TERMINAL_INPUT_MAX_CHARS`, 4096) e
  a taxa por conexão (`NEURONS_TERMINAL_INPUT_PER_SEC`, 100); recusa com `error { code, message }`
  e não responde quando aceita. **O texto digitado não é guardado** (nem em log, nem em evento,
  nem na mensagem de erro); também não há evento "alguém digitou" (uma tecla por mensagem encheria
  o log). Sem conexão com o runner, recusa com `terminal_unavailable` em vez de perder a tecla em
  silêncio.
- **Protocolo do runner na entrega T14b: revisão 2 dentro da versão 1.** O `call`
  `report_tool_call` foi acrescentado nessa etapa; cada ponta anuncia a sua revisão no `register`/`registered` (campo
  opcional, ausente = 1) e só usa o recurso novo quando a outra o tem. Servidor antigo + runner
  novo e o contrário continuam funcionando. **Estado atual: revisão 5** (`PROTOCOL_REVISION`; a 4 trouxe o resize, a 5 o snapshot do terminal na reconexão):
  a revisão 3 acrescentou ferramentas do grafo/credenciais por agente, e a 4, resize do terminal.
- **Saída do terminal na reconexão: o resumo (`replay: true`, ~200 mil caracteres por terminal)
  basta para o xterm.js** e ficou como está: a TUI repinta a tela, e o resumo inclui o que passou
  durante a queda. Só uniformizei o runner remoto para guardar chunks inteiros (como o local),
  em vez de cortar a string no meio. Gravar a saída no log foi descartado (centenas de KB por
  minuto). Lacuna conhecida: no `hybrid`, o que o runner imprime com a conexão runner ↔ servidor
  caída não chega ao servidor.
- **Demo** (`pnpm --filter @neurons/server demo`, nos dois perfis) agora mostra os eventos novos
  e digita no terminal do Pesquisador pelo `/ws` (e confere a recusa `not_a_terminal` no
  Revisor). Sem rodada com o Claude Code real (cota).

**T14c (feita, 2026-11-04): execução sobre o desenho, painel do agente e terminal.** Detalhes e
como a T15b reaproveita em `apps/web/src/runs/live/README.md` (seção "Execução sobre o desenho").
Decisões:

- **Reducer:** `AgentStateChanged` passa a ser a fonte do estado do agente (`stateSource: "event"`);
  a dedução antiga ficou só como reserva para quem nunca reportou estado (execuções anteriores à
  T14b). Continua puro e idempotente por `seq`. O terminal ganhou `terminalMeta`
  (`resets`/`total`) para a tela escrever só o que é novo e trocar tudo quando chega o `replay`.
- **Linha do tempo única:** `selectActivity(state, agent?)` junta `timeline` e `toolCalls` (do
  Codex) por `seq`, sem guardar nada duas vezes; a seção "Memórias e ferramentas" virou "Linha do
  tempo" e a mesma lista serve a conversa de cada agente.
- **Canvas só leitura sem duplicar o editor:** `editor/flow-model.ts` (setas e anotações, extraído
  do `graph-editor.tsx` sem mudar o comportamento) e `editor/nodes.tsx` (o bloco ganhou `data.live`
  com estado e custo) são usados pelos dois; `editor/graph-viewer.tsx` só desliga arrastar, ligar,
  apagar e desenhar. Bloco e agente se ligam por `node.name`. A versão vem de
  `GET /graphs/{id}/versions` + `/versions/{n}` (imutável, buscada uma vez).
- **Pulso:** SVG `animateMotion` ao longo do caminho da seta (`editor/pulse-edge.tsx`), sem
  JavaScript por quadro; `pulsesByEdge` resolve a seta e o sentido (`reverse`), `useActivePulses`
  anima cada mensagem uma vez, só se for recente (o histórico ao abrir a tela não vira rajada) e
  com teto de 12 simultâneos. A seta fica âmbar enquanto o pulso passa; `prefers-reduced-motion`
  mostra só um ponto.
- **Terminal:** xterm.js 6.0.0 (mesma versão do `@xterm/headless` do servidor). O tamanho era o do PTY (120×40) sem `@xterm/addon-fit`; o `terminal.resize` veio depois (ver "Redimensionamento do terminal" abaixo). O que se digita vai por `terminal.input` (colagens longas partidas em 4000
  caracteres), nunca é logado, e as recusas do servidor aparecem no painel em pt-BR. CSP: só
  estilos inline (já liberados); `script-src 'self'` intacto, conferido no build servido pelo
  servidor com o CLI de mentira.
- **Falta:** uma rodada com o Claude Code real (cota Pro) para confirmar a digitação e o redimensionamento no terminal real.

**Redimensionamento do terminal (feito, 2026-11-05).** `@xterm/addon-fit` 0.11.0 (a versão publicada junto com o xterm 6.0.0) **só mede** a caixa; a tela segue o tamanho do terminal do servidor.

- **Mensagem:** `terminal.resize { runId, agent, cols, rows }` no `/ws`, sem resposta quando aceita (a resposta é o evento efêmero `TerminalResized { cols, rows }` para todos que acompanham a execução). Mesmas checagens do `terminal.input` (execução em andamento e da organização de quem pede, agente de terminal `pty`) mais faixa de 20–400 colunas e 5–200 linhas (`invalid_size`) e no máximo 5 mensagens por segundo por conexão (`resize_rate_limited`). Erros em pt-BR. O painel manda o tamanho da caixa com 200 ms de debounce, uma vez ao abrir, e de novo depois de reconectar.
- **Vários clientes:** vale o **menor tamanho entre os conectados** (colunas e linhas separadas), como o tmux: todos veem a tela inteira como o programa a desenhou, e um cliente maior que chega não mexe no que os outros veem. Quando o menor sai o terminal volta a crescer. Decisão registrada em `apps/server/README.md` ("Tamanho do terminal").
- **Runtime:** `TerminalAgentRuntime` ganhou `size`, `resize()` e `onResize()`. O `ClaudeTerminalRuntime` redimensiona o PTY e a tela headless que ele lê. **O resumo `replay` recomeça no redimensionamento** e traz `cols`/`rows` (o que foi impresso para o tamanho antigo sairia embaralhado no novo; a TUI repinta sozinha com o `SIGWINCH`). No Windows o ConPTY repinta a própria tela uma vez depois do corte.
- **Perfil `hybrid`:** protocolo do runner **revisão 4**, ainda na versão 1: `agent.resize` (servidor → runner) e `agent.resized` (runner → servidor, na ordem da saída). Compatível nos dois sentidos: o servidor só manda `agent.resize` a um runner que anunciou a revisão 4; um runner antigo continua funcionando, só não redimensiona.
- **Testes:** validação, recusas e taxa (unitários e `live-events.int.test.ts` pelo `/ws`), regra de vários clientes, runtime com a CLI de mentira num PTY de verdade (`--show-size`), protocolo e `RunnerHost` (inclusive servidor sem a revisão 4), servidor + runner de ponta a ponta e o painel (`run-detail-live.test.tsx`).

**Aceitação real com a CLI (2026-11-11).** Claude Code 2.1.321 real (CLI do app desktop, assinatura Pro, modelo Haiku 5.5, sem chave de API), servidor com PGlite e a interface servida por ele, no navegador do app. **Digitar:** setas e Enter digitados no painel chegaram à CLI (responderam ao diálogo "confiar na pasta" e a execução seguiu). **Redimensionar:** com a janela estreitada o texto da TUI foi reflowado na hora. **Recarregar a página:** o terminal voltou redesenhado pelo `replay`, no mesmo estado. **Falha achada e corrigida:** um tamanho pedido enquanto o runner estava desconectado era descartado (a conexão volta, o PTY fica no tamanho antigo e a tela segue cortada); agora o servidor repete o último tamanho pedido ao receber o `agent.snapshot` (teste em `remote-runtime.test.ts`). Não conferido com o agente ocioso no prompt: a execução termina quando todos ficam ociosos, então o texto livre no prompt não pôde ser digitado sem gastar um turno; as teclas de controle provam o caminho. **Passou, com uma correção.**

### T15 — Histórico e replay

Dividida em duas:

- **T15a · Lista de execuções com filtros: feita.** `GET /runs` filtra por `status`, `graphId`, `graphVersionId`, faixa de custo (`minCostUsd`/`maxCostUsd`, sobre o custo conhecido) e início (`from`/`to`), ordena (`sort`/`order`) e pagina por `offset` (`{ items, total, limit, offset }`); cada item traz grafo, versão, status, datas, `durationMs`, `costUsd` e `unknownCostTurns`, com o custo agregado do log em uma consulta (sem N+1) e índices na migration `0004`. Custo desconhecido nunca vira 0 e o filtro compara a parte conhecida (detalhes no README do servidor). A tela `/runs` tem a barra de filtros, a tabela, a paginação e o estado vazio, com tudo no endereço.
- **T15b · Replay no canvas: feita (2026-11-04).** `/runs/:id?replay=1` (só para execução terminada; a lista `/runs` ganhou o botão "Replay"). Mesmo `GraphViewer`, sem `/ws`. Decisões:
  - **Carga:** `GET /runs/{id}/events` em páginas de 1000 por `fromSeq` até uma página curta, com contador de eventos carregados.
  - **Estado:** `reduceRunEvent` dobrado até o cursor; **ponto de controle (snapshot) a cada 50 eventos**, então arrastar a barra dobra no máximo 49 eventos.
  - **Tempo:** horários reais dos eventos ÷ velocidade (0,5× a 8×); **esperas acima de 2 s em 1× viram 2 s** e há piso de 150 ms. A tela diz isso (trechos encurtados, duração do replay contra a real).
  - **Pulsos:** só um passo para frente (um evento) desenha o pulso, na seta e no sentido certos; voltar e arrastar mostram o estado parado. Lista própria no player em vez de `useActivePulses`, que não repetiria um pulso depois de voltar.
  - **Terminal:** não é reproduzido (a saída não fica no log); a tela e o painel do agente avisam.
  - **Complementado pela T15c em 2026-11-05:** a lista já ordena por duração e a API informa o total de eventos para exibir o progresso do replay.
- **T15c · Pendências fechadas (2026-11-05).** `GET /runs/{id}/events` agora devolve também `total` (contagem de eventos da execução inteira, por chave primária `(run_id, seq)`, independente de `fromSeq`/`limit`; quem só lia `items` não muda), e o carregamento do replay mostra "N de M (X%)". `GET /runs` aceita `sort=durationMs` (`finishedAt - startedAt`); **execuções sem fim ou sem início ficam no fim da lista nos dois sentidos** (`asc` e `desc`), e a tela `/runs` ganhou "Mais demoradas" e "Mais rápidas". Testes nos dois bancos.

**Pronto quando (T15a):** com execuções de grafos e versões diferentes, cada filtro e as combinações dão o conjunto certo, na API e na tela (testes de integração nos dois bancos e da tela).
**Pronto quando (T15b):** o replay de uma execução mostra as mensagens na ordem certa e nas setas certas.

---

## Fase 3 · Mundo de fora

### T16 — Gatilhos externos e WhatsApp

Dividida em duas:

- **T16a · Webhook e agendamento: feita (2026-11-04).** Detalhes e exemplos no README do servidor ("Gatilhos externos"). Decisões:
  - **Versão que roda:** sempre a **publicada mais recente**, lida na hora de disparar; sem versão publicada (ou sem o gatilho nela) o disparo é recusado com erro claro. Não há versão fixada; se fizer falta, um campo `version` opcional no gatilho.
  - **Porta separada** (`NEURONS_HOOKS_PORT`, desligada por padrão): outra instância do Fastify com uma só rota, `POST /hooks/{hookId}`; a API nunca responde ali. Escuta em `127.0.0.1` (outro endereço segue `NEURONS_ALLOW_REMOTE`); o túnel (Cloudflare, documentado, nada instalado) aponta só para ela.
  - **Id opaco por gatilho** (128 bits) na URL, em vez de `graphId/triggerId`: não vaza ids internos nem se adivinha.
  - **Assinatura:** HMAC-SHA256 de `timestamp.corpo cru` (`X-Neurons-Timestamp`, `X-Neurons-Signature: sha256=<hex>`), segredo gerado pelo servidor, cifrado pelo `SecretsService` e mostrado uma vez (criação e troca); janela de 5 min, comparação em tempo constante, reenvio recusado (assinaturas gravadas por 11 min, atômico). Tudo que é credencial errada volta o mesmo `401`; `202` com o `runId`.
  - **Limites:** 256 KB (`NEURONS_HOOKS_MAX_BODY_KB`), 60 chamadas/min por gatilho (`NEURONS_HOOKS_RATE_PER_MIN`; ids inexistentes dividem um limite), só JSON ou texto. O corpo é a entrada da execução (mensagem do `@trigger`); log nunca grava segredo, assinatura nem corpo.
  - **Agendamento** no processo do servidor com `croner` 10.0.1 (5 campos, `timezone?` opcional, padrão o fuso do sistema), validado no `graph-schema` com mensagem em pt-BR. **Sem sobreposição** (pula e registra o motivo); **horários perdidos não são recuperados** (app fechado ou computador dormindo); última e próxima execução gravadas no gatilho.
  - **Estado fora do grafo:** ativo/desativado (padrão desativado), segredo e última/próxima execução em `graph_triggers` (migration `0005`); ativar não publica versão. API: `GET /graphs/{id}/triggers/{triggerId}`, `POST …/secret`, `PUT …/enabled`.
  - **Tela:** o inspetor do gatilho mostra URL, "Gerar/Trocar segredo" (uma vez, com aviso), `curl` assinado, cron com explicação em português, as próximas 3 execuções e o fuso.
  - **Desktop:** o agendador e a porta dos webhooks só funcionam com o app aberto.
  - **Validação e configuração posteriores:** em 05/11, `demo:triggers` validou cron em dois minutos consecutivos no servidor, com banco temporário e CLI simulada. Desde 06/11, o desktop tem Configurações → Gatilhos externos para ligar/desligar e escolher a porta (T21). Falta conferir esse caminho e o cron no app desktop instalado.
  - **Segredo órfão: resolvido (2026-11-05).** O `SecretsService` ganhou `delete`. Apagar um grafo (só os nunca publicados podem ser apagados) remove, **na mesma transação**, os segredos de webhook dos gatilhos dele (`webhook.<hookId>`); trocar o segredo já o substitui no mesmo nome (o antigo deixa de valer na hora). Para os órfãos que já existiam, a rotina `OrphanWebhookSecrets` roda na partida do servidor, é idempotente e só apaga nomes **exatamente** `webhook.` + id gerado (22 caracteres base64url) sem linha em `graph_triggers` (um segredo com nome escolhido à mão nunca é tocado); registra quantos removeu. Sem migration.
- **T16b · WhatsApp: implementada (11/11/2026); aceitação real pendente do Rafael.** WhatsApp Cloud API oficial da Meta como gatilho e como ferramenta de resposta, sobre a porta dos gatilhos da T16a. Detalhes, contratos e o passo a passo no README do servidor ("WhatsApp (T16b)"). Decisões:
  - **Contratos conferidos na documentação da Meta em 11/11/2026** ([webhooks do WhatsApp](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks), [componentes](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components), [Webhooks da Graph API](https://developers.facebook.com/docs/graph-api/webhooks/getting-started), [enviar mensagens](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages)): `GET` com `hub.mode`/`hub.verify_token`/`hub.challenge`; `X-Hub-Signature-256` (`sha256=` + HMAC-SHA256 do corpo com o App Secret); `POST` de mensagem (`entry[].changes[].value.messages[]`, `metadata.phone_number_id`) e de status (`value.statuses[]`); reenvio por até 7 dias; envio por `POST /{phone-number-id}/messages` na **Graph API `v27.0`**; janela de 24 h. O código de erro `131047` (janela fechada) veio de fontes de terceiros, não da página oficial consultada.
  - **Schema (só acréscimos):** gatilho `kind: "whatsapp"` com `phoneNumberId` e `appSecretName` (nome do segredo do App Secret); o **verify token** é gerado pelo servidor e guardado sob o id do gatilho (como o segredo do webhook), por isso não tem nome no grafo. Ferramenta `kind: "whatsapp"` com `phoneNumberId` e `accessTokenSecret` (nome do segredo do token). Ligação `uses` ganha `allowWrite?`. Grafos antigos seguem válidos.
  - **Uma execução por mensagem** da versão publicada mais recente (não há conversa que continue: a execução é finita; a próxima mensagem do cliente é outra execução). **Idempotência pelo `wamid`**, registrado antes de iniciar (tabela `whatsapp_messages`, migration `0014`), lembrado por 8 dias.
  - **Dado pessoal:** telefone, nome e texto fora do log e dos eventos; o agente não vê o telefone e a ferramenta não tem campo de destinatário (a resposta vai sempre ao cliente da execução); o número é apagado 25 h depois.
  - **Agente que lê cliente começa sem ferramenta de escrita:** aplicado no servidor (a ferramenta some da lista e a chamada é recusada) a memória com escrita, HTTP que não seja `GET` e MCP, até a ligação dizer `allowWrite`; aviso no inspetor.
  - **Fora do escopo:** templates, mensagens que não são texto, cliente identificado só por nome de usuário (BSUID), continuação de conversa entre execuções.
  - **Provado:** testes do esquema, da ferramenta (Meta falsa em HTTP), do serviço e de ponta a ponta (`whatsapp.int.test.ts`: confirmação da URL, mensagem assinada → execução → resposta recebida pela Meta falsa com o texto e o número certos, assinatura errada, reenvio, status). **Pendente:** a aceitação real com o número de teste da Meta (o passo a passo está no README do servidor).

**Pronto quando (T16a):** um `POST` assinado dispara a versão publicada mais recente; assinatura errada, vencida ou repetida volta 401 sem criar execução; a API normal não responde na porta dos gatilhos; o `schedule` dispara no horário e não sobrepõe.
**Pronto quando (T16b):** mensagem no número de teste dispara a execução e a resposta volta no WhatsApp.

### T17 — Templates

Implementada em `codex/t17-templates`, a partir de `a2ce21e`. Catálogo portátil em `packages/graph-schema/templates`, com nome, descrição, categoria, grafo, instruções e anotações em pt-BR:

- **Venda → pós-venda:** webhook → Vendedor → PosVenda, com ferramenta HTTP de pedido, modelos Sonnet/Haiku 5.5 e referências de segredo. O endpoint `example.invalid` deve ser substituído; criar os segredos e configurar/ativar o webhook continua sendo decisão explícita do usuário.
- **Pesquisa com revisor:** gatilho manual, Pesquisador e Revisor em Claude Code (Haiku 5.5, sessões estruturadas), conversa bidirecional com limite de mensagens. Usa a assinatura da CLI; sem agente de API.
- **Agente principal + CLIs no terminal:** Principal por API (Sonnet 5.5) delega a Executor (Sonnet 5.5) e Revisor (Haiku 5.5) em terminais Claude Code. Cada ligação tem limite próprio.

**Portabilidade aprovada por Rafael:** o contrato atual exige `cwd` absoluto. As receitas guardam apenas `cwd: "."`; a tela pede a pasta do computador do runner **antes de criar**. `instantiateTemplate` injeta essa pasta na cópia e o grafo configurado passa em `validateGraph` sem alteração por `migrateGraph`. Nenhum caminho da máquina fica no catálogo e o contrato não foi alterado.

A tela `/new` oferece projeto em branco e os três templates, com prévia por `GraphViewer` só leitura e selo de necessidade de chave nos que usam API. Cria um id novo pela API existente, salva o rascunho e abre o editor. **Não publica, ativa webhook ou inicia execução automaticamente.** Falha no salvamento pode ser repetida sem criar outro projeto.

**Verificação:** testes de catálogo cobrem validação/migração das instâncias, portabilidade, referências de segredo, modelos, orçamentos e limites. Testes da tela cobrem prévias, escolha, id novo, conteúdo salvo, projeto vazio e erros. O teste de aceitação `node packages/graph-schema/templates/verify-fake-cli.mjs` valida criação, reabertura, publicação explícita e a conversa Pesquisador ↔ Revisor pelo servidor e runner usando apenas o CLI de mentira.

**Resultado da validação local (2026-11-04):** 48 tarefas de lint/tipagem/testes/build passaram no monorepo, com 127 testes do esquema e 159 da interface; contrato OpenAPI em dia. Aceitação gratuita concluída: três templates criados com ids próprios, reabertos e publicados no banco de teste; Pesquisa com revisor terminou com pergunta, resposta e resultado. No navegador, o fluxo de criação confirmou rascunho sem versão publicada, pasta aplicada e ausência de exceções JavaScript.

**Guardas:** todos os agentes possuem `budgetUsd` e `idleTimeoutSec`; todas as ligações têm `maxMessages`. Orçamento configurado não resolve custo desconhecido: nos runtimes de API, a limitação real em USD continua dependente de relatório de custo/preços. Limites de mensagens e tempo ocioso seguem ativos.

**Pendente da T07:** executar e encerrar os dois templates com agentes de API usando chaves e modelos reais. Nenhuma chamada paga ou rodada real com Claude Code faz parte desta validação. As chaves devem ser criadas pelo usuário em Conexões de IA; `secretName` é somente o nome de referência, e o cabeçalho HTTP usa `{{secret:ORDERS_API_TOKEN}}`.

**Aceitação real com a CLI (2026-11-11).** Pela tela `/new`: "Pesquisa com revisor" criado com a pasta de trabalho informada, aberto no editor (grafo válido) e **publicado** (versão 1); os dois agentes saem como `claude-haiku-5-5`, `stream-json`, orçamento 0,20 e ocioso 120 s. **A execução até o `finish` não foi feita**: o teto de cinco execuções reais da rodada já tinha sido usado (três delas gastas por erro de planejamento meu: a execução termina quando o agente fica ocioso, então "responda pronto e aguarde" encerra tudo, e o Bash de `sleep 45` foi barrado pela CLI). **Parcial**; falta uma execução real curta (Executar → pedido de uma frase) e conferir se a CLI aceita o id `claude-haiku-5-5` em `--model`.

### T18 — Landing

- Trazer `E:\Notes\Design\NeuronsAI\pagina-real` para `apps/site` e publicar (Vercel ou GitHub
  Pages), com a lista de espera apontando para um destino definido pelo Rafael.
- Botões de download por sistema (Windows, macOS, Linux) apontando para a última versão no GitHub Releases.


**Estado (revisado e integrado na `dev`):**

- Feito: seção "Baixar" com detecção do sistema e links vindos de `releases/latest` (API pública, sem token, cache em `sessionStorage` tolerante a falha, "Primeira versão em breve" sem release/erro/limite); "Como instalar" (SmartScreen, Gatekeeper, Linux, conferência do `SHA256SUMS.txt`); lista de espera desligada por padrão (destino em `src/config.ts`); CSP estrita sem script/estilo inline; `.github/workflows/pages.yml` só com `workflow_dispatch`, `pages: write`/`id-token: write` só no deploy; SEO e acessibilidade.
- **Consulta em 2026-11-06:** nenhuma release encontrada no GitHub; a consulta ao site do GitHub Pages retornou 404. Publicação em hospedagem externa não foi verificada. O workflow do Pages continua manual.
- **Hospedagem junto ao servidor:** a T18 externalizou CSS, JavaScript, fontes e dados. O caminho `landingRoot` em `apps/server/src/ui/serve-ui.ts` ainda entrega apenas o HTML da landing e usa a raiz web para os demais arquivos. Antes de usar `NEURONS_LANDING_DIR` em produção, integrar a entrega de assets da landing e conferir os headers/CSP. A hospedagem estática separada usa o build completo de `apps/site/dist`.
- Depende do Rafael: (1) onde hospedar (GitHub Pages ou domínio próprio) e ativar o Pages; (2) o destino da lista de espera (`VITE_WAITLIST_URL` + `VITE_WAITLIST_ENABLED=true`); (3) a URL pública do modelador para o `pages.yml`; (4) a primeira release, para os botões de download ficarem ativos.

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

**Implementação entregue (2026-11-04); aceitação real e estabilidade sob carga pendentes.** Como rodar e empacotar em `apps/desktop/README.md`. Decisões:

- **Electron 45.2.2 e electron-builder 26.18.0**, versões exatas. O servidor roda no processo principal (perfil `local`, runner embutido) por `@neurons/server` (novo ponto de entrada `embed`, sem subir nada ao importar), escutando em `127.0.0.1` na porta 0 (o sistema escolhe, sem janela entre "está livre?" e escutar).
- **Uma origem só.** O próprio servidor serve o `apps/web/dist` (`createApp(config, { ui })`): a interface em `/`, a API em `/api` (o prefixo é tirado por `rewriteUrl`, sem mexer em controller) e o WebSocket em `/ws`. Sem preload, sem CORS e sem segundo servidor.
- **Segurança:** `contextIsolation`, `sandbox`, sem `nodeIntegration`, sem preload; CSP restritiva enviada pelo servidor; todo pedido da janela que não vá ao servidor local é cancelado, permissões negadas, `window.open` e navegação para fora bloqueados (links `http(s)` abrem no navegador do sistema).
- **Diferenças por sistema sem duplicar:** pasta de dados e CLI do Claude vêm da config do servidor (`data-dir.ts`, `claude-binary.ts`); árvore de processos de `process-tree.ts`; só o menu e os atalhos (`menu.ts`) são do desktop. O `userData` do Electron fica em `<pasta de dados>/electron`.
- **O MCP `neurons` roda com `ELECTRON_RUN_AS_NODE=1`** (`mcpServer.env`, novo): sem isso o CLI do Claude abriria outra janela do app em vez do servidor MCP.
- **Duas travas.** Instância única do Electron (`requestSingleInstanceLock`) e `DirectoryLock` (`<pasta>/db.lock` com o PID, criado de forma atômica; trava de processo morto é retomada), usada pelo `PgliteDatabaseProvider`: vale para o servidor avulso também. Falhas ao subir (`abortOnError: false`) viram mensagem para o usuário, não saída silenciosa.
- **Config própria:** `NEURONS_DESKTOP_CLAUDE_COMMAND`/`_ARGS` (CLI de mentira para testes) em `apps/desktop/src/config.ts`, o único arquivo do pacote que lê o ambiente (exceção no lint, como `runner/src/config.ts`).
- **Empacotamento:** `asar: false` por ora (o CLI e o node-pty leem arquivos do disco); o `--dir` não gera instalador. `scripts/smoke.mjs` abre o app (do código-fonte ou empacotado) com o CLI de mentira e roda o `two-terminals.json`; roda no CI do Windows.
- **Ícone provisório** (neurônio âmbar sobre grafite) gerado por `scripts/make-icon.mjs`; o definitivo substitui `build/icon.png`.

**Pendências resolvidas (2026-11-06).**

- **Porta dos webhooks no app:** item **Configurações** (só no app para computador) com **Gatilhos externos**: liga/desliga e porta (1024–65535, padrão 3101, **desligado por padrão**). A escolha fica em `<pasta de dados>/desktop-settings.json` e vai ao servidor embutido quando ele inicia (`NEURONS_HOOKS_PORT` no ambiente, se existir, manda); mudar pede reiniciar, e a tela avisa e oferece o botão. Mostra o endereço local e o link do túnel da Cloudflare. Porta ocupada: o app abre com os gatilhos desligados e diz o porquê. IPC com três ações validadas (`settings-controls.ts`).
- **Encerramento:** o `before-quit` agora fecha contas e servidor com limite de tempo por etapa (3 s e 12 s) e **sai sempre** (`shutdown.ts`, testado com tempo falso: etapa que falha ou trava não segura a saída; `process.exit` de reserva em 4 s). Uma etapa lenta é registrada com os tipos de recurso ainda abertos. Revisados e descartados como causa: o agendador (só `setTimeout`, limpo em `onModuleDestroy`), a porta dos webhooks (fechada em `onModuleDestroy`), o timer do `electron-updater` (`unref`) e o node-pty (terminal fechado com a execução). Medição inicial, antes da continuação de 06–07/11: com 4 apps em paralelo a saída levava de 1 s a ~15 s (sem carga, ~2 s) e **falhava 1 em ~12** quando o `app.close()` do servidor passa do limite; a causa então permanecia em investigação, e o smoke passou a imprimir o tempo de saída e o que estava aberto para a próxima rodada no CI.

**Fechamento lento sob carga: causa achada (2026-11-11).** Com a CLI de mentira (script `shutdown:load` do `@neurons/server`: 4 instâncias, PGlite, PTY e stream-json vivos, um visitante no `/ws`, 4 processos queimando CPU) o fechamento levou de 2,5 a 4,9 s, sem reproduzir os 20 s. A causa de uma cauda longa foi achada de outro jeito: **`Supervisor.stopRuntime` esperava o boot do agente terminar antes de mandar parar**, e o boot de um agente PTY pode durar até 60 s (diálogo de "confiar na pasta" que ninguém responde) ou 90 s (CLI lenta). Medido: `stopRun` com um agente parado no diálogo levou **58,5 s**; agora **1,2 s**. Em carga, um boot lento a ponto de ainda estar de pé na hora de fechar explica o 1 em ~12. Correção: o `stop()` do runtime aborta o boot, que se desfaz sozinho (PTY, ponte e arquivos) e termina sem erro; o Supervisor para o runtime sem esperar o boot. Também: depois do `stopAll` o Supervisor deixa de dizer "quieto" (a consulta de quiescência corria contra o fechamento do banco e deixava um erro no log) e o servidor registra o tempo de parar os agentes e do banco quando passam de 1 s. Descartado: PGlite (30 a 640 ms), `/ws` e conexão HTTP aberta (`forceCloseConnections`), runner embutido, registro de runners, agendador. Não limitei o `taskkill` (sem evidência).

### T22 — Release multiplataforma

- `release.yml` disparado por tag `v*`: matriz macOS (dmg arm64 e x64), Windows (instalador NSIS) e Linux (AppImage e deb) com `electron-builder`.
- Publica rascunho no GitHub Releases com os instaladores e checksums.
- Atualização automática com `electron-updater` lendo o GitHub Releases.
- Sem assinatura nesta etapa: README e página de download explicam o aviso do sistema na primeira abertura (SmartScreen no Windows, Gatekeeper no macOS).

**Pronto quando:** uma tag gera os instaladores dos três sistemas e o app instalado se atualiza sozinho para a versão seguinte.

**Pipeline implementado (2026-11-04); publicação e aceitação final pendentes.** Detalhes em `apps/desktop/README.md` (seções "Instaladores e release" e "Atualização automática"). Decisões:

- **`release.yml`:** tag `v*` ou execução manual com `publish` (padrão `false`). Matriz Windows (NSIS), macOS (dmg + zip, arm64 e x64) e Linux (AppImage + deb). Com `publish: false` só sobem artefatos do workflow; com tag (ou `publish: true`) um job final, o único com `contents: write` e `GITHUB_TOKEN`, cria um **rascunho** de release com instaladores, `latest*.yml`, blockmaps e `SHA256SUMS.txt`. Nenhum segredo novo.
- **Versão = tag.** O job `version` falha se `vX.Y.Z` não bater com `apps/desktop/package.json`.
- **`asar: true`**, só o node-pty fora (`asarUnpack`: `prebuilds`, `build`, `third_party`). A interface (`extraResources`) já fica fora do asar; o MCP `neurons` roda dentro dele pelo `ELECTRON_RUN_AS_NODE`. O smoke passa com asar.
- **`electron-updater` 6.8.11**, provedor GitHub (repositório público, sem token): checa 15 s após abrir e a cada 4 h; baixa em segundo plano; a barra "Nova versão pronta… Reiniciar para atualizar" usa o IPC restrito (`neurons:update`, `neurons:update-state`, origem validada). Nunca instala sozinho (`autoInstallOnAppQuit: false`); com execução em andamento, pergunta antes.
- **macOS sem assinatura e `.deb`:** só avisam "baixe a nova versão" com o link da release (`MAC_BUILD_SIGNED` em `update-policy.ts` liga a atualização automática quando a T23 assinar). AppImage e Windows atualizam sozinhos.
- **NSIS não é one-click:** no one-click o electron-builder nomeia a pasta pelo pacote (`@neuronsdesktop`) e o atalho do Menu Iniciar falhava.
- **Ícone:** `make-icon.mjs` agora gera `icon.png` (512), `icon.ico` e `icon.icns`; o desenho continua provisório.
- **Fica para a T23:** assinatura (Windows e macOS), notarização, atualização automática no macOS.
- **Teste local no Windows:** 0.0.1 → 0.0.2 por servidor HTTP local (provedor `generic` só em build de teste), ver o README.

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

- **Prova da entrega com o `two-terminals.json`.** `pnpm --filter @neurons/server demo` roda a execução com o runner embutido (perfil `local`); `demo -- --profile=hybrid` roda a mesma execução com o runner **em outro processo**, conectado por WebSocket. Mesmos 11 eventos, mesmo resultado; só o perfil muda. O runtime de API da T07 já existe com testes simulados; a prova real do `mixed.json` continua pendente por depender de chaves/modelos reais.
- **Protocolo v1, em zod** (`packages/runner-protocol`, fonte única). Todo frame é JSON com `v` e `type`; um `v` desconhecido é recusado antes de qualquer outra leitura. Runner → servidor: `register`, `heartbeat`, `agent.state`, `agent.output`, `call`, `response`. Servidor → runner: `registered`, `reject`, `heartbeat`, `agent.start`, `agent.deliver`, `agent.stop`, `agent.input`, `call.result`. Além dos oito itens do plano, entraram `call`/`call.result` (as ferramentas do agente — `send_message`, `ask`, `reply`, `list_peers`, `finish`, `report_usage` — precisam chegar ao Hub, que fica no servidor) e `agent.input` (o usuário digita no terminal do agente). `AgentCommunication.listPeers` passou a poder devolver uma promessa.
- **Reconexão sem perder mensagem.** Tudo que cruza a conexão é idempotente por id: o servidor reenvia o pedido que o runner não respondeu (`agent.start`, `agent.deliver`, `agent.stop`), o runner responde a repetição com o que já fez (um `message.id` já entregue não é entregue de novo) e o runner reenvia o `call` sem resultado (o servidor responde com o desfecho da primeira execução, sem enviar a mensagem duas vezes; guarda os últimos 2000). O `register` de cada conexão lista os agentes vivos do runner: o servidor atualiza os estados perdidos (um `idle` perdido volta a acionar a entrega da caixa de entrada) e responde com `keep`, a lista que ainda quer; o runner para os demais (órfãos de um servidor que reiniciou).
- **Carência de 60 s** (`NEURONS_RUNNER_GRACE_SEC`): a conexão que cai não falha os agentes; só se o runner não voltar nesse prazo é que viram `AgentFailed` ("não voltou"). Um runner que volta sem o agente (reiniciou) também o falha ("perdeu o agente"). Heartbeat nos dois sentidos a cada 15 s; 3 batidas perdidas fecham a conexão. O runner reconecta com espera crescente (0,5 s até 15 s) e desiste só se o servidor o recusar.
- **Perfis** (`NEURONS_PROFILE`): `local` (padrão) hospeda os agentes num **runner embutido** que fala o mesmo protocolo por um canal em memória; `hybrid` não hospeda nada e aceita runners em `/runner`; `hosted` se comporta como `hybrid` até a T26. Um agente novo vai ao runner conectado com menos agentes, esperando até 30 s por um (`NEURONS_RUNNER_WAIT_SEC`) antes de falhar com "Nenhum runner conectado".
- **Token por runner.** Emitido pelo servidor (`pnpm --filter @neurons/server runner:token create <nome>`), mostrado **uma única vez** e guardado só como SHA-256 (tabela `runners`, migration `0003_runners`; o token é longo e aleatório, 256 bits, `nrn_...`, então hash rápido basta). Vai no cabeçalho `Authorization: Bearer` do upgrade do WebSocket, nunca no endereço, em log ou em frame. Revogar (`runner:token revoke <nome>`) recusa o runner e derruba o conectado na próxima checagem (a cada batida). O runner se recusa a mandar o token em `ws://` para outra máquina (precisa de `wss://` ou `NEURONS_RUNNER_ALLOW_INSECURE=true`). A T25 acrescentou emissão/revogação autenticadas por REST e pelo painel `/runners`, com escopo por organização; o CLI continua disponível para administração.
- **Código.** `packages/runner-protocol` (frames, codec, canais, canal em memória), `packages/runner` (`RunnerHost`, que hospeda os runtimes da T08; `RunnerConnection`, o cliente WebSocket que reconecta; programa `neurons-runner`) e, no servidor, `src/runners/` (`RemoteAgentRuntime`, `RunnerLink`, `RunnerRegistry`, `RunnerGateway`, `EmbeddedRunner`, tokens). O Hub e o Supervisor não mudaram: o `RemoteAgentRuntime` implementa a mesma `AgentRuntime`.
- **`total_cost_usd` é acumulado na sessão** (resposta à pergunta da T10). Medido com o Claude Code 2.1.309 e Haiku, em sessões stream-json: com turnos de 586, 4 e 4 tokens de saída os totais foram 0,00099 → 0,00155 → 0,00200 (crescem mesmo com um turno minúsculo no meio) e `modelUsage` soma os tokens dos turnos (586 → 590 → 594), enquanto `usage` é por turno. Antes o orçamento contava o custo em dobro (ou mais) a cada turno. O `ClaudeStreamJsonRuntime` agora reporta a diferença para o total anterior (`costOfTurn`); o CLI falso passou a acumular como o real. Custo das duas rodadas reais: ≈ US$ 0,004 no total. O `--max-budget-usd` do CLI compara com esse mesmo total acumulado, então continua coerente.
- **Pendências:** demo real (`--real-claude`) no perfil `hybrid` e runtime de API rodando num runner (hoje roda no servidor). Seleção por `runtime.runnerId` e recuperação da cauda recente do terminal via snapshot na revisão 5 foram implementadas na continuação de 06–07/11; o modo automático continua usando o menos carregado da organização. REST/UI de emissão e revogação já foram entregues na T25. A conexão remota do desktop não inicia o runner automaticamente.

**Aceitação real com a CLI no `hybrid` (2026-11-11).** Servidor `hybrid` e runner em **outro processo**, ligado por um proxy TCP que corta a conexão. Execução completa até o `finish` (mesmo `ToolCalled` do perfil local). Quedas de 2 a 14 s: o runner reconectou sozinho, o agente continuou, a tela (`agent.snapshot`) voltou e o diálogo seguiu respondendo. **Falha achada e corrigida:** redimensionar durante a queda se perdia (ver T14). **Ajuste:** o aviso "Parando um agente que o servidor não quer mais" aparecia também para um agente que já tinha sido parado e é só lembrado por 60 s; deixou de aparecer. Só o mid-turn com queda **dentro** do turno não foi capturado (o turno acabou antes do corte); o caminho está coberto pelos testes de reconexão. **Passou.**

**`--permission-mode` (2026-11-11).** `manual`, `acceptEdits`, `plan`, `dontAsk` e `auto` sobem na CLI real, em PTY (o rodapé mostra "manual mode on", "accept edits on", "plan mode on", "don't ask on", "auto mode on") e em stream-json, **sem enviar prompt** (`test:e2e:permission-modes`, nenhuma cota). **Passou.** Também corrigido: o servidor não achava a CLI do app desktop neste Windows (as versões novas do app guardam a CLI em `%LOCALAPPDATA%Claude-Data…claude-code`); `claude-binary.ts` procura lá e vale a versão mais nova.

### T25 — Contas e multiusuário

**Integrada na `dev` após revisão (2026-11-05).** Google OIDC/PKCE, sessão web com renovação rotativa, isolamento dos recursos por organização, papéis, runners por organização e login do desktop pelo navegador do sistema. Testado só com provedor simulado. Ver [[T25 - Google e recursos por organizacao]] e [[T25 - Desktop remoto]].

**Revisão de segurança e correção (Claude, 2026-11-05).** OIDC (PKCE S256, state/nonce de uso único, JWKS do Google, RS256 fixo, `iss`/`aud`/`azp`/`exp`/`nonce`), sessões (hash SHA-256, renovação rotativa com revogação da família no reuso, CSRF e cookies `__Host-`), isolamento REST, runners e desktop foram conferidos sem achado de vazamento entre organizações no estado atual. Corrigido: (1) `/ws` — `unsubscribe` antes de `subscribe` desligava a revalidação por evento (teste novo falha sem a correção); (2) web — o `/ws` autentica pelos cookies do handshake, então depois da rotação o servidor devolve `invalid_session`; o cliente agora renova a sessão e reabre o socket; (3) desktop — "Esquecer sessão salva" revoga no servidor mesmo sem cookies abertos nesta execução, e a partição remota recusa downloads; (4) `/new` — o projeto em branco deixado por uma falha ao salvar o template é reaproveitado.

**Pendências que bloqueavam a exposição pública: resolvidas (2026-11-05).** A T26 está desbloqueada quanto a estas três; o que falta para ela está no fim desta seção. Detalhes e variáveis em [README do servidor](../../apps/server/README.md#servidor-público-guardas-t25).
- **SSRF — resolvido.** Nos perfis `hybrid`/`hosted`, `http` e MCP por HTTP passam por `createGuardedFetch` (`packages/tools/src/net`): só `http(s)` nas portas de `NEURONS_OUTBOUND_ALLOWED_PORTS` (80 e 443), DNS resolvido uma vez no soquete e conexão no endereço validado (sem rebinding), qualquer endereço interno na resposta barra a chamada (loopback, `0.0.0.0`, link-local/metadados, RFC 1918, CGNAT, `fc00::/7`, reservados e IPv4 embutido em IPv6), redirecionamentos conferidos um a um (máximo 5; entre origens vão sem cabeçalhos nem corpo). Exceções por `NEURONS_OUTBOUND_ALLOW_HOSTS`. Perfil `local` sem guarda. Testes por classe de endereço, rebinding e redirecionamento.
- **Cadastro aberto — resolvido.** Fechado por padrão: identidade nova só entra por convite de `owner`/`admin` (e-mail verificado, 14 dias, tabela `organization_invitations`, migration `0012`) ou se o e-mail/domínio está em `NEURONS_SIGNUP_ALLOWED_EMAILS`/`_DOMAINS`. Sem isso: "Acesso só por convite" na tela (web e desktop). `NEURONS_SIGNUP_OPEN=true` reabre (só servidor privado). Endpoints `…/organizations/:id/invitations`.
- **Segredos — resolvido pelo modelo "admin publica".** Publicar versão com `{{secret:...}}` em qualquer string exige `admin`/`owner` (`403 secret_publish_forbidden`); `member` publica o resto. Lista de hosts permitidos por segredo ficou fora (seria coluna nova em `secrets` e UI): continua sendo a evolução natural.
- **Sem contas, fora do loopback:** `NEURONS_ALLOW_REMOTE=true` sem as variáveis do Google deixa a API aberta (inclui MCP stdio no servidor). É o comportamento anterior, agora documentado nos comentários. Continua valendo: **não** exponha o servidor sem contas.

**Dados locais, cotas e limpeza (2026-11-05; concorrência revisada em 06/11).**
- **Adoção dos dados locais.** Servidor com contas começa vazio para cada organização; os dados antigos (`organization_id` NULL) ficam fora de todas. `GET /auth/organizations/{id}/local-data` mostra o que há e `POST /auth/organizations/{id}/adopt-local-data` (`{ "confirm": true }`) move tudo para a organização. **Só `owner` daquela organização, só com contas ligadas, ação única e confirmada, nunca automática.** Numa transação: grafos (com versões, execuções e gatilhos, que acompanham o grafo) e segredos, que são **recriptografados** porque a organização faz parte do que o AES-GCM autentica; depois as pastas de memórias vão para a pasta da organização, uma a uma (uma segunda chamada termina o que uma queda deixou e, sem nada, não faz nada). Recusa com 409 se há execução local em andamento ou se a organização já tem segredo com o mesmo nome; sem a chave mestra certa nada é movido. Gatilhos com agenda ficam **desligados** (o temporizador em memória é do escopo local) e o dono liga de novo. Runners e conexões do Claude (que são do computador, não do banco) não mudam. Na tela, painel de organizações > "Dados locais deste servidor", só para o `owner` e só quando há o que mover, com aviso e confirmação. O perfil `local` sem conta não muda.
- **Cotas por organização** (só onde há organização; o perfil `local` sem conta não tem cotas; `0` desliga). Estourar responde **429** com mensagem em pt-BR. Variáveis `NEURONS_QUOTA_ORGANIZATIONS_PER_USER` (5; organizações de que a conta é proprietária, contando o espaço pessoal), `NEURONS_QUOTA_MEMORIES_PER_ORG` (50), `NEURONS_QUOTA_MEMORY_MB_PER_ORG` (512), `NEURONS_QUOTA_CONCURRENT_RUNS_PER_ORG` (5) e `NEURONS_QUOTA_RUNS_PER_DAY_PER_ORG` (500, janela móvel de 24 h). Organizações travam a linha da conta. A contagem e criação de execução ocorrem na mesma transação com trava por organização; duas partidas concorrentes não ocupam a mesma vaga. Criação/importação de memória confere a cota e grava em fila por organização **neste processo de servidor**; essa fila não é uma trava distribuída para múltiplas réplicas.
- **Teste instável de `graphs`:** a causa era `updatedAt` carimbado pelo relógio do host (`$onUpdate`) contra `createdAt` do relógio do banco (`now()`); o repositório agora carimba o `updatedAt` também com `now()` do banco, então `updatedAt >= createdAt` não depende mais de dois relógios.

**Atualização 07/11:** permissões por rota/controller, rotação de webhook restrita a gerenciamento de credenciais, limite de corpo comum de 1 MiB e painel de convites foram entregues.

**Dívidas menores:** tokens de runner antigos (escopo `NULL`) continuam valendo e não são adotados; `/ws` não fecha upgrade sem sessão (cada operação já exige); HTTP em loopback aceito também no app empacotado; `Retry-After`/limite de tentativas usa `request.ip` (atrás de proxy é preciso configurar `trustProxy`). A importação de memórias mantém 30 MiB; os demais endpoints usam 1 MiB. Convites podem ser gerenciados pela interface e pela API.

**Depende do Rafael:** criar o OAuth client no Google Cloud (tipo "Aplicativo da Web"; URI de redirecionamento exata `<origem>/api/auth/google/callback` com a interface servida junto, ou `/auth/google/callback` sem ela; HTTP só em loopback), configurar `NEURONS_PUBLIC_ORIGIN`, `NEURONS_GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `NEURONS_MASTER_KEY` e perfil `hybrid`/`hosted` fora do Git, e aceitar o login real no Electron (reinício com o cofre) nos três sistemas.

**Para a T26 (o que ainda falta quanto à exposição):** definir as listas `NEURONS_SIGNUP_ALLOWED_*` (ou convidar o primeiro e-mail: com cadastro fechado e sem lista o primeiro `owner` precisa ser criado antes, por lista ou `NEURONS_SIGNUP_OPEN=true` temporário), pôr `trustProxy` atrás do balanceador (limites por IP), e só então abrir. A guarda de SSRF no código é a primeira camada; o isolamento de rede da AWS (grupos de segurança e sub-redes do contêiner, metadados restritos) continua recomendado como a segunda.

- **Login com Google** (OpenID Connect com PKCE), atrás de uma interface de provedor de identidade para dar para acrescentar outros depois. No app desktop, o login abre o **navegador do sistema** e volta para o app por deep link `neuronsai://` (ou endereço local de retorno) — nunca numa janela embutida, que o Google bloqueia.
- Sessão do NeuronsAI com tokens próprios (acesso curto + renovação rotativa); no app desktop ficam no cofre do sistema (`safeStorage` do Electron: Keychain, Credential Manager, libsecret).
- Credencial do provedor (client secret do Google) só na config/Secrets Manager, nunca no código.
- Organizações e papéis; grafos, execuções, runners e segredos isolados por organização.
- **Depende do Rafael:** criar o OAuth client no Google Cloud (grátis).
- Runner vinculado a uma conta por token emitido pelo servidor e revogável.
- O perfil `local` continua funcionando sem conta.

**Pronto quando:** dois usuários no mesmo servidor não enxergam nada um do outro (testes de isolamento).

**Melhorias da revisão (10/11/2026).** Rota de escrita sem `@RequirePermission` passa a ser recusada (negação por padrão; as de membro declaram `write`); `local-data-adoption.json` corrompido responde 409 em pt-BR sem liberar a adoção; modos de `--permission-mode` conferidos com a CLI 2.1.321 (sai o `default`; `manual` existe); `EPIPE` do PTY tratado no runtime do terminal; teste da migration `0013_credential_approval` sobre dados antigos (Postgres e PGlite); servidor da revisão 5 testado com runners das revisões 4 e 6; `openai-compatible` sem `NEURONS_OPENAI_COMPATIBLE_BASE_URL` diz qual variável falta; limite de saída dos modelos em `NEURONS_MODEL_MAX_OUTPUT_TOKENS` (padrão 8192); o cliente compatível devolve só os campos do contrato de Chat Completions; `.gitattributes` marca os binários (o repositório já estava em LF); orçamento de tempo dos testes do PGlite na config do vitest.

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
