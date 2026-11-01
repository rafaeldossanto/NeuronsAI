// Valida o servidor MCP sem a CLI: cliente oficial do SDK por stdio chama send_message e o Hub recebe.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startHub, ROOT } from './lib.mjs';
import path from 'node:path';

const hub = await startHub();
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, 'src/mcp-server.mjs')],
  env: { ...process.env, NEURONS_HUB_URL: hub.url },
});
const client = new Client({ name: 'selftest', version: '0.0.0' });
await client.connect(transport);
console.log('tools:', (await client.listTools()).tools.map((t) => t.name));
const t0 = Date.now();
const res = await client.callTool({ name: 'send_message', arguments: { to: 'agente-b', text: 'ola' } });
console.log('resultado:', JSON.stringify(res.content));
const ev = await hub.waitFor('mcp:send_message', { timeoutMs: 3000 });
console.log('hub recebeu:', JSON.stringify(ev?.data), `em ${ev ? ev.recvAt - t0 : '?'}ms`);
await client.close();
process.exit(ev ? 0 : 1);
