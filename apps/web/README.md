# @neurons/web

Interface do NeuronsAI: Vite 8, React 19, Tailwind 4 (componentes no estilo shadcn/ui), TanStack Query e `react-router`. Consome a API real pelo [`@neurons/api-client`](../../packages/api-client/README.md).

Telas: **Grafos** (`/graphs`: listar e criar), **Editor** (`/graphs/:id`: canvas, inspetor, validação ao vivo, salvar rascunho, publicar versão e versões publicadas) e **Execuções** (`/runs`: tabela paginada com filtros de status, grafo, versão, faixa de custo e período, todos no endereço; `/runs/:id`: ao vivo pelo `/ws`, com o desenho da versão em que roda, o estado e o custo de cada agente nos blocos, o pulso âmbar nas setas, o painel do agente com o terminal ao vivo, a linha do tempo, o botão Parar e o envio de mensagem como `@human`; uma execução terminada tem o **Replay**, em `/runs/:id?replay=1`).

Também estão integrados **Novo projeto** (`/new`, vazio ou com um dos três templates),
**Conexões de IA** (`/connections`), **Memórias** (`/memories`), **Organizações**
(`/organizations`), **Runners** (`/runners`) e **Configurações** (`/settings`, controles de
gatilhos no desktop). Contas são opcionais no servidor; os painéis administrativos exigem
sessão e papel apropriado. Implementação e aceitação real são acompanhadas no
[plano consolidado](../../Docs/Plano/Plano%20de%20Implementação.md#estado-consolidado).

## Rodar

Primeira vez (o cliente da API precisa estar compilado):

```bash
pnpm install
pnpm --filter @neurons/api-client build
```

Em dois terminais:

```bash
pnpm --filter @neurons/server dev   # API em http://127.0.0.1:3100 (banco embutido, sem Docker)
pnpm --filter @neurons/web dev      # app em http://127.0.0.1:5173
```

O Vite encaminha `/api/*` para o servidor (o prefixo é removido) e `/ws` (WebSocket, sem prefixo) como está, então o navegador só fala com uma origem. Variáveis (todas opcionais):

| Variável             | Onde            | Padrão                  | Para quê                                                  |
| -------------------- | --------------- | ----------------------- | --------------------------------------------------------- |
| `NEURONS_API_TARGET` | Vite (`.env`)   | `http://127.0.0.1:3100` | Para onde o proxy de desenvolvimento aponta.              |
| `VITE_API_URL`       | build do bundle | `/api`                  | URL da API no build (`vite build`). Nunca ponha segredos. |

`import.meta.env` só é lido em `src/config.ts`.

## Lista de execuções (`/runs`)

Os filtros vivem na query string (`?status=failed&graphId=…&graphVersionId=…&minCostUsd=1&maxCostUsd=5&from=2026-11-01&to=2026-11-30&sort=costly&page=2`), então recarregar ou mandar o link mantém a seleção; valores inválidos no endereço são ignorados. Mudar um filtro volta à página 1. Os dias de `from`/`to` valem do começo ao fim do dia, no fuso do usuário. A versão só aparece para um grafo escolhido. O custo é a soma dos turnos que informaram preço: a tabela mostra `≥ $x` quando há turnos sem preço e `Desconhecido` quando nenhum informou, nunca zero (o filtro de custo compara essa parte conhecida, ver o README do servidor). Páginas de 20 por `offset`; clicar na linha abre `/runs/:id`; as terminadas têm o botão **Replay**, que abre `/runs/:id?replay=1`. Código em `src/runs/` (`run-filters.ts` lê e escreve o endereço; `runs-filter-bar.tsx`, `runs-table.tsx`, `use-run-list.ts`) e `src/runs/runs-page.tsx`.

## Testes e build

```bash
pnpm --filter @neurons/web test       # Vitest + Testing Library, com o fetch simulado
pnpm --filter @neurons/web build      # gera dist/
```

## Editor (canvas e inspetor)

`@xyflow/react` (React Flow) em `src/graphs/editor/`. O **estado é o próprio JSON do grafo** (`GraphDefinition` do `@neurons/graph-schema`), num reducer puro com histórico (`model.ts`); a tela só dispara as mesmas ações que o teste da fixture usa.

- **Blocos:** agente (ícone de nuvem para API, de terminal para CLI), ferramenta e gatilho. **Setas:** conversa (linha cheia, simples ou dupla pelo campo `bidirectional`) e uso de ferramenta (tracejada). A seta do gatilho é o campo `target` dele, não uma ligação.
- **Inspetor:** Nome, Papel, Contexto, Runtime (API: fornecedor e modelo; terminal: CLI, comando, pasta, argumentos, modo), Esforço, Orçamento, Tempo ocioso, ferramentas e gatilhos. Sem seleção, edita o nome do grafo.
- **Validação:** `validateGraph` a cada mudança; o erro aparece no bloco (borda vermelha e aviso), no inspetor e numa lista clicável abaixo do canvas. "Publicar versão" fica desabilitado enquanto houver erro.
- **Salvar/publicar:** "Salvar rascunho" faz `PATCH /graphs/:id` com o documento inteiro; "Publicar versão" salva o que estiver pendente e chama `POST /graphs/:id/versions`.
- **Desfazer/refazer:** Ctrl+Z, Ctrl+Shift+Z (ou Ctrl+Y) e os botões; até 100 passos. Digitar num campo e arrastar um bloco contam como um passo só.
- **Modelador:** grade de 20 px com encaixe, minimapa, controles de zoom, `Delete` apaga, arrastar no fundo faz seleção em caixa (Ctrl/Shift soma) e o botão do meio ou o direito arrasta a tela.
- **Preserva o que não edita:** chaves desconhecidas em blocos, setas e anotações voltam intactas no salvar. Só se grava `mode` num terminal se for diferente do padrão (`pty`).
- **CSP do desktop:** o React Flow usa estilos inline, que a CSP do servidor já permite (`style-src 'self' 'unsafe-inline'`); `script-src` continua só `'self'`.

### Camada livre (anotações)

Por cima do grafo tipado, uma camada de desenho à mão (`roughjs`): **retângulo, elipse, seta livre, texto, nota e grupo**, salvos em `annotations[]` (o servidor ignora). Escolha a ferramenta na barra (atalhos `V R O A T N G`, `Esc` volta a selecionar) e arraste no canvas; um clique cria no tamanho padrão. Texto, cor, preenchimento e fonte ficam no inspetor.

- **Mesmo histórico:** criar, mover, redimensionar, editar texto e apagar anotações são passos do mesmo reducer e do mesmo desfazer/refazer dos blocos (`model.ts`); não existe um segundo histórico.
- **Grupo:** `memberIds` guarda blocos e/ou anotações; ao criar, envolve o que cabe inteiro na caixa. Mover o grupo move os membros (inclusive grupos aninhados); apagar um item o tira dos grupos. A regra `group-members` do schema aceita ids de blocos e de anotações.
- **Camadas:** as anotações são nós do React Flow com `zIndex` negativo (grupo abaixo das demais), então ficam abaixo dos blocos e das setas que executam. Grupo e seta só pegam o mouse no traço e no nome, então não atrapalham ligar nem selecionar blocos. Os tipos de nó são `free-*`: o React Flow estiliza um tipo embutido chamado `group`.
- **Formato:** `position` (canto superior esquerdo), `size` (retângulo, elipse, nota, grupo), `points` (seta: relativos a `position`), `text` e `style` (`stroke`, `fill`, `fontSize`). O traço vem de `roughjs` já como caminhos SVG, com semente tirada do `id` para não tremer; sem eval nem script inline.

Nos testes com jsdom, `src/test/setup.ts` simula `ResizeObserver`, `DOMMatrixReadOnly` e o tamanho dos elementos (o React Flow precisa disso para montar). Selecionar um bloco é um `fireEvent.click`, porque o d3-drag não aceita o clique simulado do user-event.

## Execução ao vivo (canvas e terminal)

`/runs/:id` mostra o **desenho da versão** da execução com o mesmo canvas do editor, só leitura (`graphs/editor/graph-viewer.tsx`, que reaproveita `nodes.tsx` e `flow-model.ts`; nada de arrastar, ligar ou apagar). Cada bloco de agente mostra o estado (subindo, ocupado, ocioso, esperando resposta, falhou, finalizado) e o custo; a cada mensagem um pulso âmbar percorre a seta no sentido de quem mandou (SVG `animateMotion`, leve mesmo com muitas mensagens). Clicar num bloco abre o painel do agente: a conversa dele e, para agente de terminal em `pty`, o **terminal ao vivo** (xterm.js 6.0.0) onde o que você digita vai por `terminal.input`; as recusas do servidor aparecem no painel em pt-BR. Custo por agente, total, Parar e mensagem como `@human` continuam na tela. Como os dados chegam, o replay e as decisões: [`src/runs/live/README.md`](src/runs/live/README.md).

O xterm.js só usa estilos inline, que a CSP do servidor/desktop já permite; `script-src` continua `'self'`.

## Replay (`/runs/:id?replay=1`)

Só para execução **terminada** (em andamento, a tela fica ao vivo e avisa). Mesmo canvas só leitura, sem abrir o `/ws`: os eventos vêm de `GET /runs/{id}/events`, em páginas de 1000 por `fromSeq` até uma página curta (com o contador "N carregados"). Controles: tocar/pausar, voltar e avançar um evento, 0,5× · 1× · 2× · 4× · 8× e uma barra que arrasta a qualquer evento. O estado em cada ponto é o `reduceRunEvent` dobrado desde o começo, com um **ponto de controle a cada 50 eventos**, então arrastar nunca refaz tudo.

- **Tempo:** cada evento toca pelo intervalo real em relação ao anterior, dividido pela velocidade, mas **esperas acima de 2 s (em 1×) viram 2 s** e há um piso de 150 ms para eventos colados. A tela diz isso, com quantos trechos foram encurtados e quanto dura o replay contra a execução real.
- **Pulsos:** só um passo para frente (de um em um evento) desenha o pulso daquela mensagem, na seta e no sentido certos; voltar e arrastar mostram o estado parado.
- **Terminal:** não é reproduzido (a saída dele não fica no registro); o painel do agente avisa e mostra só a conversa.

Código em `src/runs/live/replay*.ts(x)`, `use-run-events.ts`, `use-replay-player.ts`.

## Estrutura e visual

```
src/
  config.ts          única leitura de import.meta.env
  styles.css         tokens (cores, fonte, raios) no formato de variáveis do shadcn/ui
  accounts/          organizações, convites, conta do desktop e auth/ (sessão)
  graphs/            páginas e consultas dos projetos; editor/ (canvas e inspetor), templates/
  runs/              histórico, filtros, detalhes; live/ (eventos, replay e terminal)
  runners/           cadastro e gerenciamento de runners
  memories/          cadastro, importação e tipos das memórias
  connections/       painel de conexões dos provedores
  triggers/          consultas e comandos dos gatilhos
  settings/          configurações do desktop
  updates/           aviso de atualização do desktop
  shell/             navegação, layout e moldura da janela
  workspace/         composição de recursos e abertura dos painéis
  shared/            API, formatação, estados, modal e ui/ (controles reutilizados)
  test/              helpers: fetch simulado e dados de exemplo
```

Páginas, componentes específicos, consultas e testes ficam no seu domínio. As rotas
continuam em `app.tsx`. Convenções e mapa completo: [Estrutura do projeto](../../Docs/Estrutura%20do%20projeto.md).

Fundo `#F7F7F4`, grafite, âmbar `#E9A15C` (foco e pulso de "em execução"), fonte Manrope, nada de azul. Para mudar uma cor, edite só `src/styles.css`.

## T17 — Novo projeto a partir de template

A rota `/new` agora oferece **Projeto em branco** e três modelos: **Venda → pós-venda**, **Pesquisa com revisor** e **Agente principal + CLIs no terminal**. Cada card usa o `GraphViewer` existente em modo só leitura e indica quando precisa de chave de API. O editor e o visualizador não foram alterados.

Ao escolher um template, revise o nome. Nos modelos com Claude Code, informe a pasta absoluta no computador do runner; no desktop há seleção nativa de pasta. Essa escolha foi aprovada pelo Rafael para manter caminhos privados fora das receitas, sem alterar o contrato que exige `cwd` absoluto.

A criação valida a cópia configurada, faz `POST /graphs` para obter um id novo, grava o conteúdo com `PATCH /graphs/:id` e abre o editor. O projeto fica como **rascunho**: não publica versão, não ativa webhook e não inicia execução. Uma falha de PATCH pode ser repetida sem criar outro projeto. Projeto em branco mantém o canvas vazio.

As receitas estão em [packages/graph-schema/templates](../../packages/graph-schema/templates/README.md), exportadas como `listTemplates`, `getTemplate` e `instantiateTemplate`. O template nunca traz credenciais: configure os segredos nomeados em Conexões de IA. O fluxo de vendas também precisa do endpoint real da API de pedidos e da configuração do webhook no editor.

Testes novos: catálogo validado após informar a pasta, migração sem alteração, caminhos/segredos, orçamentos e limites; na tela, prévias, criação dos três modelos com id novo, ausência de publicação automática, erro e repetição de salvamento. Para o teste real com servidor local, PGlite e CLI de mentira, após build, use `node packages/graph-schema/templates/verify-fake-cli.mjs`.

**Pendente da T07:** rodar os dois modelos com agente de API usando chaves e modelos reais, com validação de consumo. Pesquisa com revisor foi preparado para CLI oficial pela assinatura; nesta entrega, a execução é validada somente com a CLI de mentira, sem chamada paga.
