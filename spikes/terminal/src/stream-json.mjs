// Alternativa estruturada: `claude -p --input-format stream-json --output-format stream-json` como sessao persistente.
// Dois turnos na MESMA sessao (o 2o prova memoria/persistencia) com o MCP neurons; mede eventos e latencias.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { cleanEnv, findClaudeBin, startHub, ROOT, LOGS, SANDBOX } from './lib.mjs';

const hub = await startHub();
const mcpConfig = path.join(LOGS, 'mcp-config.json');
fs.writeFileSync(mcpConfig, JSON.stringify({
  mcpServers: { neurons: { command: process.execPath, args: [path.join(ROOT, 'src/mcp-server.mjs')], env: { NEURONS_HUB_URL: hub.url } } },
}, null, 2));

const t0 = Date.now();
const child = spawn(findClaudeBin(), [
  '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--model', 'haiku', '--permission-mode', 'default', '--setting-sources', 'project',
  '--mcp-config', mcpConfig, '--strict-mcp-config', '--allowedTools', 'mcp__neurons__send_message',
], { cwd: SANDBOX, env: { ...cleanEnv(process.env), NEURONS_HUB_URL: hub.url }, stdio: ['pipe', 'pipe', 'pipe'] });

const events = [];
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));
const waiters = [];
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  let ev;
  try { ev = JSON.parse(line); } catch { return; }
  const rec = { ms: Date.now() - t0, type: ev.type, subtype: ev.subtype, ev };
  events.push(rec);
  for (const w of [...waiters]) if (w.match(rec)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(rec); }
});
const waitEvent = (match, timeoutMs = 90000) => new Promise((resolve) => {
  const past = events.find(match);
  if (past) return resolve(past);
  const w = { match, resolve };
  waiters.push(w);
  setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); resolve(null); } }, timeoutMs);
});

const send = (text) => child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
const turns = [];
const run = async (label, text) => {
  const sentAt = Date.now() - t0;
  const nResults = events.filter((e) => e.type === 'result').length;
  send(text);
  const result = await waitEvent((e) => e.type === 'result' && events.filter((x) => x.type === 'result').length > nResults);
  const mine = events.filter((e) => e.ms >= sentAt);
  turns.push({
    label, sentAt,
    firstEventMs: mine[0] ? mine[0].ms - sentAt : null,
    firstAssistantMs: mine.find((e) => e.type === 'assistant') ? mine.find((e) => e.type === 'assistant').ms - sentAt : null,
    toolUseMs: mine.find((e) => e.type === 'assistant' && JSON.stringify(e.ev.message?.content).includes('tool_use'))?.ms - sentAt,
    resultMs: result ? result.ms - sentAt : null,
    eventTypes: [...new Set(mine.map((e) => `${e.type}${e.subtype ? ':' + e.subtype : ''}`))],
    result: result && { is_error: result.ev.is_error, text: result.ev.result, duration_ms: result.ev.duration_ms, duration_api_ms: result.ev.duration_api_ms, num_turns: result.ev.num_turns, total_cost_usd: result.ev.total_cost_usd, usage: result.ev.usage && { input_tokens: result.ev.usage.input_tokens, output_tokens: result.ev.usage.output_tokens, cache_read_input_tokens: result.ev.usage.cache_read_input_tokens } },
  });
};

let code = 0;
try {
  await run('turno-1-mcp', 'Chame a ferramenta send_message do MCP neurons com to="agente-b" e text="ola via stream-json". Depois responda apenas: feito.');
  const call = hub.events.find((e) => e.kind === 'mcp:send_message');
  await run('turno-2-memoria', 'Para quem era essa mensagem? Responda apenas o nome.');
  const init = events.find((e) => e.subtype === 'init');
  const out = { spawnToInitMs: init?.ms ?? null, initMcp: init?.ev.mcp_servers, initTools: init?.ev.tools?.filter((t) => t.startsWith('mcp__')), permissionMode: init?.ev.permissionMode, mcpCallReceived: call ? call.data : null, turns, stderr: stderr.slice(0, 300) };
  fs.writeFileSync(path.join(LOGS, 'stream-json.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (!call || turns.some((t) => !t.result || t.result.is_error)) code = 1;
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  child.stdin.end();
  setTimeout(() => process.exit(code), 1500).unref();
  child.once('exit', () => process.exit(code));
}
