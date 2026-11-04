# @neurons/web

Interface do NeuronsAI: Vite 8, React 19, Tailwind 4 (componentes no estilo shadcn/ui), TanStack Query e `react-router`. Consome a API real pelo [`@neurons/api-client`](../../packages/api-client/README.md).

Telas: **Grafos** (`/graphs`: listar e criar), **Editor** (`/graphs/:id`: canvas, inspetor, validação ao vivo, salvar rascunho, publicar versão e versões publicadas) e **Execuções** (`/runs` e `/runs/:id`: status, consumo e eventos).

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

O Vite encaminha `/api/*` para o servidor (o prefixo é removido), então o navegador só fala com uma origem. Variáveis (todas opcionais):

| Variável             | Onde            | Padrão                  | Para quê                                                  |
| -------------------- | --------------- | ----------------------- | --------------------------------------------------------- |
| `NEURONS_API_TARGET` | Vite (`.env`)   | `http://127.0.0.1:3100` | Para onde o proxy de desenvolvimento aponta.              |
| `VITE_API_URL`       | build do bundle | `/api`                  | URL da API no build (`vite build`). Nunca ponha segredos. |

`import.meta.env` só é lido em `src/config.ts`.

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
- **Preserva o que não edita:** `annotations[]` (da T13) e quaisquer chaves desconhecidas em blocos e setas voltam intactas no salvar. Só se grava `mode` num terminal se for diferente do padrão (`pty`).
- **CSP do desktop:** o React Flow usa estilos inline, que a CSP do servidor já permite (`style-src 'self' 'unsafe-inline'`); `script-src` continua só `'self'`.

Nos testes com jsdom, `src/test/setup.ts` simula `ResizeObserver`, `DOMMatrixReadOnly` e o tamanho dos elementos (o React Flow precisa disso para montar). Selecionar um bloco é um `fireEvent.click`, porque o d3-drag não aceita o clique simulado do user-event.

## Estrutura e visual

```
src/
  config.ts          única leitura de import.meta.env
  styles.css         tokens (cores, fonte, raios) no formato de variáveis do shadcn/ui
  lib/               api (cliente, ApiError, unwrap), queries (TanStack Query), format
  components/        layout, estados (carregando, erro, vazio) e ui/ (button, card, input, badge, skeleton)
  editor/            canvas e inspetor: model (reducer e histórico), issues, nodes, inspector, graph-editor
  routes/            uma página por tela, com seus testes
  test/              helpers: fetch simulado e dados de exemplo
```

Fundo `#F7F7F4`, grafite, âmbar `#E9A15C` (foco e pulso de "em execução"), fonte Manrope, nada de azul. Para mudar uma cor, edite só `src/styles.css`.
