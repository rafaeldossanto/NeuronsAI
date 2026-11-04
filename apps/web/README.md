# @neurons/web

Interface do NeuronsAI: Vite 8, React 19, Tailwind 4 (componentes no estilo shadcn/ui), TanStack Query e `react-router`. Consome a API real pelo [`@neurons/api-client`](../../packages/api-client/README.md).

Telas: **Grafos** (`/graphs`: listar e criar), **Editor** (`/graphs/:id`: dados, rascunho e versões; a área do canvas fica reservada para a T12) e **Execuções** (`/runs` e `/runs/:id`: ao vivo pelo `/ws`, com status, agentes, custo, mensagens, botão Parar e envio de mensagem como `@human`).

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

## Testes e build

```bash
pnpm --filter @neurons/web test       # Vitest + Testing Library, com o fetch simulado
pnpm --filter @neurons/web build      # gera dist/
```

## Estrutura e visual

```
src/
  config.ts          única leitura de import.meta.env
  styles.css         tokens (cores, fonte, raios) no formato de variáveis do shadcn/ui
  lib/               api (cliente, ApiError, unwrap), queries (TanStack Query), format
  live/              dados ao vivo de uma execução: cliente do /ws, reducer puro e useRunLive (ver live/README.md)
  components/        layout, estados (carregando, erro, vazio) e ui/ (button, card, input, badge, skeleton)
  routes/            uma página por tela, com seus testes
  test/              helpers: fetch simulado e dados de exemplo
```

Fundo `#F7F7F4`, grafite, âmbar `#E9A15C` (foco e pulso de "em execução"), fonte Manrope, nada de azul. Para mudar uma cor, edite só `src/styles.css`.
