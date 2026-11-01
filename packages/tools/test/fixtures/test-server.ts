import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

/** MCP server used by the tests: a few tools, one failing, one reading its env, one slow. */
export function createTestServer(): McpServer {
  const server = new McpServer({ name: "neurons-test-server", version: "0.0.0" });

  server.registerTool(
    "echo",
    { description: "Devolve o texto recebido.", inputSchema: { text: z.string() } },
    ({ text: value }) => text(`eco: ${value}`),
  );
  server.registerTool(
    "add",
    { description: "Soma dois números.", inputSchema: { a: z.number(), b: z.number() } },
    ({ a, b }) => text(String(a + b)),
  );
  server.registerTool("dangerous", { description: "Não deve ser exposta." }, () => text("perigo"));
  server.registerTool("fail", { description: "Sempre falha." }, () => ({
    isError: true,
    ...text("deu ruim"),
  }));
  server.registerTool(
    "read_env",
    { description: "Lê uma variável de ambiente.", inputSchema: { name: z.string() } },
    ({ name }) => text(process.env[name] ?? "(vazio)"),
  );
  server.registerTool(
    "wait",
    { description: "Demora a responder." },
    () => new Promise((resolve) => setTimeout(() => resolve(text("tarde")), 3_000)),
  );

  return server;
}
