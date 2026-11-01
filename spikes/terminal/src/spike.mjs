// Volta completa do spike T05: Claude Code no PTY -> ociosidade -> injecao -> MCP send_message -> resposta -> encerra.
// Gasto minimo: um unico prompt de uma linha, modelo haiku, ferramenta MCP pre-liberada (so send_message).
import fs from 'node:fs';
import path from 'node:path';
import { ClaudePty, startHub, sleep, ROOT, LOGS } from './lib.mjs';

const SILENCE_MS = Number(process.env.SILENCE_MS ?? 1500);
const PROMPT = 'Chame a ferramenta send_message do MCP neurons com to="agente-b" e text="ola do spike". Depois responda apenas: feito.';
const PROMPT_PATTERN = /\? for shortcuts|\u276f\s*(\r|\n|$)/; // rodape da TUI / caixa de entrada

const fail = (msg, code = 1) => { console.error(`\nSPIKE ABORTADO: ${msg}`); return code; };

/** Injeta texto como digitado. Multilinha vai em bracketed paste (ESC[200~ ... ESC[201~) e o Enter vem depois. */
async function inject(session, text) {
  const multiline = text.includes('\n');
  session.write(multiline ? `\x1b[200~${text}\x1b[201~` : text);
  await sleep(150);
  session.write('\r');
}

/** Espera o primeiro detector de ociosidade disparar e devolve todos para comparacao. */
async function waitIdle(session, hub, since, timeoutMs = 90000) {
  const t0 = Date.now();
  const seen = {};
  while (Date.now() - t0 < timeoutMs) {
    const now = Date.now();
    if (!seen.silence && session.lastOutputAt() > since && now - session.lastOutputAt() >= SILENCE_MS) seen.silence = session.lastOutputAt() + SILENCE_MS;
    if (!seen.prompt && PROMPT_PATTERN.test(session.plain().slice(-600)) && session.lastOutputAt() > since) seen.prompt = now;
    const stop = hub.events.find((e) => e.kind === 'hook:Stop' && e.recvAt >= since);
    if (stop && !seen.stopHook) seen.stopHook = stop.recvAt;
    if (seen.stopHook) return seen; // o hook e o sinal de referencia
    await sleep(50);
  }
  return seen;
}

const hub = await startHub();
const mcpConfig = path.join(LOGS, 'mcp-config.json');
fs.writeFileSync(mcpConfig, JSON.stringify({
  mcpServers: { neurons: { command: process.execPath, args: [path.join(ROOT, 'src/mcp-server.mjs')], env: { NEURONS_HUB_URL: hub.url } } },
}, null, 2));

const session = new ClaudePty({
  hubUrl: hub.url,
  args: ['--model', 'haiku', '--setting-sources', 'project', '--mcp-config', mcpConfig, '--strict-mcp-config', '--allowedTools', 'mcp__neurons__send_message'],
});
const report = { startedAt: Date.now(), trustDialogConfirmed: false, themeConfirmed: false };
let code = 0;

try {
  // 1) Pronto: SessionStart do hook + silencio. Trata dialogos de primeira execucao.
  const bootStart = Date.now();
  while (Date.now() - bootStart < 60000) {
    const text = session.plain();
    if (/Select login method|Paste code here|Login successful/i.test(text)) throw new Error('A CLI pediu login (nao ha sessao de assinatura utilizavel). Faca "claude auth login" e rode de novo.');
    // Onboarding de primeira execucao: aceita o tema padrao (grava o tema em ~/.claude.json); login nunca e automatizado.
    if (/Choose the text style/i.test(text) && !report.themeConfirmed) { session.write('\r'); report.themeConfirmed = true; await sleep(800); continue; }
    if (/trust this folder|Do you trust the files/i.test(text) && !report.trustDialogConfirmed) { session.write('\r'); report.trustDialogConfirmed = true; await sleep(500); continue; }
    if (hub.events.some((e) => e.kind === 'hook:SessionStart') && Date.now() - session.lastOutputAt() > SILENCE_MS) break;
    await sleep(100);
  }
  if (!hub.events.some((e) => e.kind === 'hook:SessionStart')) throw new Error('SessionStart nao chegou: a CLI nao ficou pronta em 60s.');
  report.readyAt = Date.now();

  // 2) Injeta e mede.
  const mark = session.chunks.length;
  const injectedAt = Date.now();
  await inject(session, PROMPT);
  report.injectedAt = injectedAt;
  const firstByte = await (async () => { for (let i = 0; i < 600; i++) { if (session.chunks.length > mark) return session.chunks[mark].t; await sleep(20); } return null; })();
  report.firstByteMs = firstByte ? firstByte - injectedAt : null;

  // 3) Chamada MCP + volta a ociosidade.
  const call = await hub.waitFor('mcp:send_message', { since: injectedAt, timeoutMs: 90000 });
  report.mcpCall = call ? { to: call.data.to, text: call.data.text, ms: call.recvAt - injectedAt } : null;
  const idle = await waitIdle(session, hub, injectedAt);
  report.idleMs = Object.fromEntries(Object.entries(idle).map(([k, v]) => [k, v - injectedAt]));
  report.answerTail = session.plain(mark).replace(/\s+/g, ' ').slice(-300);
  if (!call) throw new Error('send_message nao chegou ao Hub.');
} catch (e) {
  code = fail(e.message);
  report.error = e.message;
} finally {
  report.hookEvents = hub.events.filter((e) => e.kind.startsWith('hook:')).map((e) => [e.kind, e.recvAt - report.startedAt]);
  fs.writeFileSync(path.join(LOGS, 'last-run.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  session.write('\x03'); await sleep(300); session.write('\x03'); await sleep(300); session.kill();
}
process.exit(code);
