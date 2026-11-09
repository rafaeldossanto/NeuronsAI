# @neurons/mcp-neurons

O servidor MCP **stdio** `neurons`, que o Claude Code (T08) inicia como processo filho de cada agente de terminal. Dá ao modelo as
ferramentas de comunicação do Hub e acesso às ferramentas autorizadas no grafo:

| Ferramenta (`mcp__neurons__…`)  | O que faz                                                   |
| ------------------------------- | ----------------------------------------------------------- |
| `send_message(to, text)`        | Envia e segue em frente.                                    |
| `ask(to, question)`             | Pergunta e **bloqueia** até a resposta ou o timeout do Hub. |
| `reply(messageId, text)`        | Responde a uma mensagem recebida.                           |
| `list_peers()`                  | Com quem o agente pode falar.                               |
| `finish(result)`                | Encerra a execução inteira.                                 |
| `list_tools()`                  | Lista ferramentas e memórias autorizadas para o agente.     |
| `use_tool(nodeId, name, input)` | Executa uma dessas ferramentas com as permissões do grafo.  |

Ele **não fala com o banco nem com o Hub**: faz HTTP para a ponte local do runtime que o criou (`127.0.0.1`, porta aleatória, token aleatório
por agente e por execução). Isso vem do `env` da entrada `neurons` no `--mcp-config` que o runtime gera:

| Variável                 | Descrição                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `NEURONS_BRIDGE_URL`     | `http://127.0.0.1:<porta>`; qualquer outro host é recusado, para o token nunca sair da máquina. |
| `NEURONS_BRIDGE_TOKEN`   | Token da ponte (mín. 32 caracteres). Nunca é logado.                                            |
| `NEURONS_ASK_TIMEOUT_MS` | Timeout do `ask` no Hub; a chamada HTTP espera um pouco mais, para o erro do Hub chegar antes.  |

`src/config.ts` é o único arquivo que lê `process.env`. Falhas da ponte voltam ao modelo como erro de ferramenta (`isError`), com a mensagem em português.

O contrato HTTP entre os dois lados (`src/protocol.ts`: rotas, formatos, nomes das ferramentas) é exportado e usado também por `@neurons/agent-runtimes`.
