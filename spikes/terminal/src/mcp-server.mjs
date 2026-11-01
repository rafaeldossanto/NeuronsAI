// Servidor MCP minimo (stdio) do spike: so a ferramenta send_message(to, text).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const hubUrl = process.env.NEURONS_HUB_URL;
const server = new McpServer({ name: 'neurons', version: '0.0.1' });

server.registerTool(
  'send_message',
  {
    description: 'Envia uma mensagem para outro agente do grafo.',
    inputSchema: { to: z.string(), text: z.string() },
  },
  async ({ to, text }) => {
    if (hubUrl) {
      await fetch(`${hubUrl}/mcp/send_message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ at: Date.now(), to, text }),
      }).catch(() => {});
    }
    return { content: [{ type: 'text', text: `entregue a ${to}` }] };
  },
);

await server.connect(new StdioServerTransport());
