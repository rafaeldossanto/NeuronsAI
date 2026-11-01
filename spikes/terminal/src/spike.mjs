// Volta completa do spike T05: Claude Code no PTY -> ociosidade -> injecao -> MCP send_message -> resposta -> encerra.
// Gasto minimo: um unico prompt de uma linha, modelo haiku, ferramenta MCP pre-liberada (so send_message).
import fs from 'node:fs';
import path from 'node:path';
import { ClaudePty, startHub, sleep, ROOT, LOGS } from './lib.mjs';

const SILENCE_MS = Number(process.env.SILENCE_MS ?? 1500);
const PROMPT = 'Chame a ferramenta send_message do MCP neurons com to="agente-b" e text="ola do spike". Depois responda apenas: feito.';
const PROMPT_PATTERN = /\? for shortcuts/; // rodape da TUI quando a caixa de entrada esta livre
const BUSY_PATTERN = /esc to interrupt|\(running|tokens\)/; // spinner / hook rodando

// Dialogos conhecidos da 2.1.309; Enter aceita a opcao ja selecionada (a segura: "No, keep browser tools off").
const DIALOGS = [
  { name: 'tema', re: /Choose the text style/i },
  { name: 'security-notes', re: /Security notes:[\s\S]*Press Enter to continue/i },
  { name: 'chrome', re: /Claude in Chrome extension detected/i },
  { name: 'trust-folder', re: /trust this folder|Do you trust the files/i },
];

const fail = (msg, code = 1) => { console.error(`\nSPIKE ABORTADO: ${msg}`); return code; };

/** Injeta texto como digitado. Multilinha vai em bracketed paste (ESC[200~ ... ESC[201~) e o Enter vem depois. */
async function inject(session, hub, text) {
  const multiline = text.includes('\n');
  const since = Date.now();
  session.write(multiline ? `\x1b[200~${text}\x1b[201~` : text);
  // Um Enter logo apos um bloco grande e tratado como parte da colagem (150 ms nao submete): espera o eco na tela.
  const probe = text.split('\n')[0].slice(0, 25);
  for (let i = 0; i < 60 && !session.screenText().includes(probe); i++) await sleep(50);
  await sleep(400);
  let enters = 0;
  for (; enters < 3; ) {
    session.write('\r');
    enters++;
    if (await hub.waitFor('hook:UserPromptSubmit', { since, timeoutMs: 2500 })) break;
  }
  return enters;
}

/** Espera o primeiro detector de ociosidade disparar e devolve todos para comparacao. */
async function waitIdle(session, hub, since, timeoutMs = 90000) {
  const t0 = Date.now();
  const seen = {};
  while (Date.now() - t0 < timeoutMs) {
    const now = Date.now();
    const quiet = now - session.lastOutputAt() >= SILENCE_MS;
    const stop = hub.events.find((e) => e.kind === 'hook:Stop' && e.recvAt >= since);
    if (stop && !seen.stopHook) seen.stopHook = stop.recvAt;
    // silencio e padrao de tela: o primeiro disparo ANTES do Stop e falso positivo; depois do Stop e o disparo valido.
    if (quiet && session.lastOutputAt() > since) {
      if (!seen.stopHook && !seen.silenceEarly) seen.silenceEarly = now;
      if (seen.stopHook && !seen.silenceAfterStop) seen.silenceAfterStop = now;
    }
    const promptIdle = PROMPT_PATTERN.test(session.screenText()) && !BUSY_PATTERN.test(session.screenText());
    if (promptIdle) {
      if (!seen.stopHook && !seen.promptEarly) seen.promptEarly = now;
      if (seen.stopHook && !seen.promptAfterStop) seen.promptAfterStop = now;
    }
    if (seen.stopHook && seen.silenceAfterStop && seen.promptAfterStop) return seen;
    if (seen.stopHook && now - seen.stopHook > 20000) return seen;
    await sleep(50);
  }
  return seen;
}

/** Amostrador de tela: guarda o rodape quando muda, para escolher o padrao de ociosidade com dados. */
function sampleScreens(session, file, t0) {
  let last = '';
  const out = [];
  const timer = setInterval(() => {
    const tail = session.screenText().split('\n').slice(-8).join('\n');
    if (tail !== last) { last = tail; out.push({ ms: Date.now() - t0, tail }); fs.writeFileSync(file, JSON.stringify(out, null, 1)); }
  }, 200);
  return () => clearInterval(timer);
}

const hub = await startHub();
const mcpConfig = path.join(LOGS, 'mcp-config.json');
fs.writeFileSync(mcpConfig, JSON.stringify({
  mcpServers: { neurons: { command: process.execPath, args: [path.join(ROOT, 'src/mcp-server.mjs')], env: { NEURONS_HUB_URL: hub.url } } },
}, null, 2));

const session = new ClaudePty({
  hubUrl: hub.url,
  args: ['--model', 'haiku', '--permission-mode', 'default', '--setting-sources', 'project', '--mcp-config', mcpConfig, '--strict-mcp-config', '--allowedTools', 'mcp__neurons__send_message'],
});
const report = { startedAt: Date.now() };
const stopSampling = sampleScreens(session, path.join(LOGS, 'screens.json'), report.startedAt);
let code = 0;

try {
  // 1) Pronto: dialogos de primeira execucao tratados pela TELA RENDERIZADA (xterm headless); login nunca e automatizado.
  const bootStart = Date.now();
  const pressed = new Map();
  let ready = false;
  while (Date.now() - bootStart < 90000) {
    const screen = session.screenText();
    if (/Select login method|Paste code here|Login successful/i.test(screen)) throw new Error('A CLI pediu login (nao ha sessao de assinatura utilizavel). Faca "claude auth login" e rode de novo.');
    const dialog = DIALOGS.find((d) => d.re.test(screen));
    if (dialog) {
      if (!pressed.has(dialog.name) && Date.now() - session.lastOutputAt() > 700) { session.write('\r'); pressed.set(dialog.name, Date.now()); }
    } else if (/❯/.test(screen) && hub.events.some((e) => e.kind === 'hook:SessionStart') && Date.now() - session.lastOutputAt() > SILENCE_MS) { ready = true; break; }
    await sleep(100);
  }
  report.dialogsConfirmed = [...pressed.keys()];
  if (!ready) throw new Error('A CLI nao chegou ao prompt em 90s. Tela: ' + session.screenText().slice(-300));
  report.readyAt = Date.now();

  // 2) Injeta e mede.
  const mark = session.chunks.length;
  const injectedAt = Date.now();
  report.enterPresses = await inject(session, hub, PROMPT);
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
  stopSampling();
  session.write('\x03'); await sleep(300); session.write('\x03'); await sleep(300); session.kill();
}
process.exit(code);
