# @neurons/web

Interface do NeuronsAI: Vite 8, React 19, Tailwind 4 (componentes no estilo shadcn/ui), TanStack Query e `react-router`. Consome a API real pelo [`@neurons/api-client`](../../packages/api-client/README.md).

Telas: **Grafos** (`/graphs`: listar e criar), **Editor** (`/graphs/:id`: canvas, inspetor, validação ao vivo, salvar rascunho, publicar versão e versões publicadas) e **Execuções** (`/runs`: tabela paginada com filtros de status, grafo, versão, faixa de custo e período, todos no endereço; `/runs/:id`: ao vivo pelo `/ws`, com o desenho da versão em que roda, o estado e o custo de cada agente nos blocos, o pulso âmbar nas setas, o painel do agente com o terminal ao vivo, a linha do tempo, o botão Parar e o envio de mensagem como `@human`).

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

Os filtros vivem na query string (`?status=failed&graphId=…&graphVersionId=…&minCostUsd=1&maxCostUsd=5&from=2026-11-01&to=2026-11-30&sort=costly&page=2`), então recarregar ou mandar o link mantém a seleção; valores inválidos no endereço são ignorados. Mudar um filtro volta à página 1. Os dias de `from`/`to` valem do começo ao fim do dia, no fuso do usuário. A versão só aparece para um grafo escolhido. O custo é a soma dos turnos que informaram preço: a tabela mostra `≥ $x` quando há turnos sem preço e `Desconhecido` quando nenhum informou, nunca zero (o filtro de custo compara essa parte conhecida, ver o README do servidor). Páginas de 20 por `offset`; clicar na linha abre `/runs/:id`. Código em `src/runs/` (`run-filters.ts` lê e escreve o endereço; `runs-filter-bar.tsx`, `runs-table.tsx`, `use-run-list.ts`) e `src/routes/runs-page.tsx`.

## Testes e build

```bash
pnpm --filter @neurons/web test       # Vitest + Testing Library, com o fetch simulado
pnpm --filter @neurons/web build      # gera dist/
```

## Editor (canvas e inspetor)

`@xyflow/react` (React Flow) em `src/editor/`. O **estado é o próprio JSON do grafo** (`GraphDefinition` do `@neurons/graph-schema`), num reducer puro com histórico (`model.ts`); a tela só dispara as mesmas ações que o teste da fixture usa.

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

`/runs/:id` mostra o **desenho da versão** da execução com o mesmo canvas do editor, só leitura (`editor/graph-viewer.tsx`, que reaproveita `nodes.tsx` e `flow-model.ts`; nada de arrastar, ligar ou apagar). Cada bloco de agente mostra o estado (subindo, ocupado, ocioso, esperando resposta, falhou, finalizado) e o custo; a cada mensagem um pulso âmbar percorre a seta no sentido de quem mandou (SVG `animateMotion`, leve mesmo com muitas mensagens). Clicar num bloco abre o painel do agente: a conversa dele e, para agente de terminal em `pty`, o **terminal ao vivo** (xterm.js 6.0.0) onde o que você digita vai por `terminal.input`; as recusas do servidor aparecem no painel em pt-BR. Custo por agente, total, Parar e mensagem como `@human` continuam na tela. Como os dados chegam, como o replay da T15b reaproveita tudo e as decisões: [`src/live/README.md`](src/live/README.md).

O xterm.js só usa estilos inline, que a CSP do servidor/desktop já permite; `script-src` continua `'self'`.

## Estrutura e visual

```
src/
  config.ts          única leitura de import.meta.env
  styles.css         tokens (cores, fonte, raios) no formato de variáveis do shadcn/ui
  lib/               api (cliente, ApiError, unwrap), queries (TanStack Query), format
  live/              execução ao vivo: cliente do /ws, reducer puro, useRunLive, painel do agente, terminal e linha do tempo (ver live/README.md)
  components/        layout, estados (carregando, erro, vazio) e ui/ (button, card, input, badge, skeleton)
  editor/            canvas e inspetor: model (reducer e histórico), issues, nodes, inspector, graph-editor; camada livre: annotations, annotation-nodes, annotation-inspector, rough-shapes; execução: flow-model, graph-viewer, pulse-edge
  routes/            uma página por tela, com seus testes
  test/              helpers: fetch simulado e dados de exemplo
```

Fundo `#F7F7F4`, grafite, âmbar `#E9A15C` (foco e pulso de "em execução"), fonte Manrope, nada de azul. Para mudar uma cor, edite só `src/styles.css`.
