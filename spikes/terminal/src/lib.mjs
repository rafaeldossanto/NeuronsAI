// Utilitarios do spike: localizar o claude, Hub HTTP local e sessao Claude em PTY.
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pty from 'node-pty';
import xtermHeadless from '@xterm/headless';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SANDBOX = path.join(ROOT, 'sandbox');
export const LOGS = path.join(ROOT, 'logs');
fs.mkdirSync(LOGS, { recursive: true });

const CLAUDE_CODE_DIR = path.join(
  process.env.LOCALAPPDATA ?? '',
  'Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/claude-code',
);

const versionKey = (v) => v.split('.').map(Number);
const cmpVersion = (a, b) => {
  const [x, y] = [versionKey(a), versionKey(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** CLAUDE_BIN, ou o claude.exe da pasta de versao mais nova embutida no app desktop. */
export function findClaudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const versions = fs.readdirSync(CLAUDE_CODE_DIR).sort(cmpVersion).reverse();
  for (const v of versions) {
    for (const sub of fs.readdirSync(path.join(CLAUDE_CODE_DIR, v))) {
      const exe = path.join(CLAUDE_CODE_DIR, v, sub, 'claude.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  throw new Error('claude.exe nao encontrado; defina CLAUDE_BIN');
}

/** Remove o que o app/sessao host injeta (CLAUDE*, ANTHROPIC*): a CLI do spike usa so o login do proprio usuario. */
export const cleanEnv = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/i.test(k)));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Hub minimo: recebe hooks e chamadas MCP por HTTP e as guarda com timestamp. */
export async function startHub() {
  const events = [];
  const waiters = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(body); } catch { /* ignora */ }
      const ev = { kind: req.url === '/hook' ? `hook:${data.event}` : 'mcp:send_message', recvAt: Date.now(), data };
      events.push(ev);
      for (const w of [...waiters]) if (w.match(ev)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); }
      res.end('ok');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    events,
    /** Espera um evento (a partir de `since`, ms epoch) cujo kind comece por `prefix`. */
    waitFor(prefix, { since = 0, timeoutMs = 60000 } = {}) {
      const match = (e) => e.kind.startsWith(prefix) && e.recvAt >= since;
      const past = events.find(match);
      if (past) return Promise.resolve(past);
      return new Promise((resolve) => {
        const w = { match, resolve };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); resolve(null); } }, timeoutMs);
      });
    },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

/** Sessao do Claude Code em PTY: acumula saida com timestamps. */
export class ClaudePty {
  constructor({ hubUrl, args = [], cols = 120, rows = 40 }) {
    this.chunks = []; // { t, d }
    this.screen = '';
    this.exited = false;
    this.term = new xtermHeadless.Terminal({ cols, rows, allowProposedApi: true });
    this.proc = pty.spawn(findClaudeBin(), args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: SANDBOX,
      env: { ...cleanEnv(process.env), NEURONS_HUB_URL: hubUrl ?? '' },
    });
    this.proc.onData((d) => { this.chunks.push({ t: Date.now(), d }); this.screen += d; this.term.write(d); });
    this.proc.onExit(() => { this.exited = true; });
  }
  write(s) { this.proc.write(s); }
  lastOutputAt() { return this.chunks.at(-1)?.t ?? 0; }
  /** Tela renderizada hoje (linhas visiveis do buffer, sem escapes). */
  screenText() {
    const b = this.term.buffer.active;
    const lines = [];
    for (let i = 0; i < this.term.rows; i++) lines.push((b.getLine(b.viewportY + i)?.translateToString(true) ?? ''));
    return lines.join('\n').replace(/\s+$/, '');
  }
  /** Texto bruto sem sequencias de escape (aproximado). */
  plain(sinceIdx = 0) {
    return this.chunks.slice(sinceIdx).map((c) => c.d).join('')
      .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
      .replace(/\x1b[()][A-Z0-9]/g, '');
  }
  /** No Windows, pty.kill() com filho vivo trava o ClosePseudoConsole: mata a arvore antes (taskkill /T). */
  kill() {
    if (this.exited) return;
    spawnSync('taskkill', ['/pid', String(this.proc.pid), '/T', '/F'], { stdio: 'ignore' });
    this.exited = true;
  }
}
