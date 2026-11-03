# @neurons/runner

O **runner**: o processo que hospeda os agentes de terminal (Claude Code em PTY ou em stream-json, da T08) e conversa com o servidor do NeuronsAI pelo protocolo de [`@neurons/runner-protocol`](../runner-protocol/README.md). O login do Claude Code fica aqui, na máquina de quem roda o runner; o servidor nunca vê o login da assinatura.

Há duas maneiras de ter um runner, e a execução é a mesma nas duas:

- **Embutido** (perfil `local` do servidor): o servidor cria um `RunnerHost` no próprio processo, ligado a ele por um canal em memória. Não há nada a configurar.
- **Separado** (perfil `hybrid`): o programa `neurons-runner` abre uma conexão **de saída** (WebSocket) para o servidor e funciona atrás de NAT.

## Rodar o runner separado

1. No servidor (`NEURONS_PROFILE=hybrid`), emita o token do runner. Ele é mostrado **uma única vez**:

   ```bash
   pnpm --filter @neurons/server runner:token create meu-notebook
   ```

2. Na máquina que vai hospedar os agentes (com o Claude Code instalado e `claude auth login` feito), copie `.env.example` para `.env` e preencha, ou defina as variáveis:

   | Variável                        | Padrão          | Descrição                                                                                                                     |
   | ------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
   | `NEURONS_SERVER_URL`            | —               | Endereço do servidor (`https://...` ou `http://...`; o runner usa `/runner` e troca para `wss://`/`ws://`).                   |
   | `NEURONS_RUNNER_TOKEN`          | —               | Token emitido pelo servidor. É segredo: não vai para log, evento nem frame.                                                   |
   | `NEURONS_RUNNER_NAME`           | nome da máquina | Como o runner aparece nos logs do servidor.                                                                                   |
   | `NEURONS_CLAUDE_BIN`            | procura sozinho | Caminho do executável do Claude Code.                                                                                         |
   | `NEURONS_RUNNER_ALLOW_INSECURE` | `false`         | O token só segue por `wss://` quando o servidor não é local. `true` aceita `ws://` para outra máquina, por sua conta e risco. |

3. Inicie:

   ```bash
   pnpm --filter @neurons/runner build
   pnpm --filter @neurons/runner start
   ```

Quem lê as variáveis é só `src/config.ts` (o lint barra `process.env` fora dele). Um erro de configuração sai em texto simples, listando tudo o que falta, sem repetir o token.

## O que o runner faz

- **`RunnerHost`** (sem rede, testável): recebe `agent.start`/`agent.deliver`/`agent.stop`, cria os runtimes pela fábrica da T08 com as configurações que o servidor manda (`askTimeoutMs`, `usageFlushMs`), repassa o estado e a saída do terminal e transforma as ferramentas do agente (`send_message`, `ask`, `reply`, `list_peers`, `finish`, uso) em `call`s ao Hub do servidor.
- **`RunnerConnection`**: mantém a conexão. Quando ela cai, os agentes **continuam rodando**; o runner reconecta com espera crescente (0,5 s a 15 s), manda no `register` os agentes que ainda tem, repete as chamadas sem resultado e para os agentes que o servidor não quer mais. Desiste só se o servidor o recusar (token desconhecido ou revogado, protocolo não suportado, perfil `local`).
- Uma mensagem entregue duas vezes (o servidor repete o pedido porque não viu a resposta) chega ao agente **uma vez só**.

## Como usar em código

```ts
import { startRunner } from "@neurons/runner";

const runner = startRunner({ url: "wss://servidor/runner", token, name: "meu-notebook" });
// ...
await runner.stop(); // fecha a conexão e para os agentes
```

`demo/runner-process.ts` do servidor é um exemplo completo (com o CLI de mentira).

## Testes

```bash
pnpm --filter @neurons/runner test
```

O `RunnerHost` é testado com um runtime de mentira e um servidor "interpretado" pelo teste (duplicidade de entrega e de início, chamadas que atravessam conexões, `keep`, `reject`, silêncio do servidor). A reconexão de ponta a ponta, com o servidor de verdade e o WebSocket real, está em `apps/server/src/runners/runner-gateway.int.test.ts`.
