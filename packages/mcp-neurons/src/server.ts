import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BridgeCallError, type BridgeClient } from "./bridge-client.js";
import { MCP_SERVER_NAME } from "./protocol.js";

interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: true;
}

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });

const failure = (error: unknown): ToolResult => ({
  content: [
    {
      type: "text",
      text: error instanceof BridgeCallError ? error.message : "Falha inesperada na ferramenta.",
    },
  ],
  isError: true,
});

/** Runs a tool body; any failure becomes a tool error the model can read and react to. */
async function guarded(body: () => Promise<string>): Promise<ToolResult> {
  try {
    return ok(await body());
  } catch (error) {
    return failure(error);
  }
}

/** Builds the `neurons` MCP server: the five communication tools, all forwarded to the bridge. */
export function createNeuronsServer(client: BridgeClient): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: "0.0.0" });

  server.registerTool(
    "send_message",
    {
      description:
        "Envia uma mensagem a outro agente e segue em frente, sem esperar resposta. Use os nomes de list_peers.",
      inputSchema: { to: z.string().describe("Nome do agente destinatário"), text: z.string() },
    },
    ({ to, text }) =>
      guarded(async () => `Mensagem entregue a ${to} (id ${await client.sendMessage(to, text)}).`),
  );

  server.registerTool(
    "ask",
    {
      description:
        "Faz uma pergunta a outro agente e espera a resposta (há um tempo limite). Use quando precisar da resposta para continuar.",
      inputSchema: { to: z.string().describe("Nome do agente destinatário"), question: z.string() },
    },
    ({ to, question }) => guarded(() => client.ask(to, question)),
  );

  server.registerTool(
    "reply",
    {
      description:
        "Responde a uma mensagem recebida, usando o id que veio com ela. A resposta vai a quem a escreveu.",
      inputSchema: { messageId: z.string().describe("Id da mensagem respondida"), text: z.string() },
    },
    ({ messageId, text }) =>
      guarded(async () => `Resposta enviada (id ${await client.reply(messageId, text)}).`),
  );

  server.registerTool(
    "list_peers",
    { description: "Lista os agentes com quem você pode conversar e quem pode falar com você." },
    () => guarded(async () => JSON.stringify(await client.listPeers(), null, 2)),
  );

  server.registerTool(
    "finish",
    {
      description:
        "Encerra a execução inteira com o resultado final. Use só quando o trabalho todo estiver concluído.",
      inputSchema: { result: z.string().describe("Resultado final da execução") },
    },
    ({ result }) =>
      guarded(async () => {
        await client.finish(result);
        return "Execução encerrada.";
      }),
  );

  return server;
}
