// Exploracao: sobe o claude no PTY, envia teclas roteirizadas (KEYS="\r@9000,..." ) e despeja a tela.
import { ClaudePty, startHub, sleep, LOGS } from './lib.mjs';
import fs from 'node:fs';
const hub = await startHub();
const c = new ClaudePty({ hubUrl: hub.url, args: process.argv.slice(2) });
const t0 = Date.now();
const steps = (process.env.KEYS ?? '').split(',').filter(Boolean).map((s) => { const [k, ms] = s.split('@'); return { k: JSON.parse(`"${k}"`), ms: Number(ms) }; });
for (const s of steps) { await sleep(s.ms); c.write(s.k); console.log(`[+${Date.now() - t0}ms] sent ${JSON.stringify(s.k)}`); }
await sleep(Number(process.env.WAIT ?? 8000));
fs.writeFileSync(`${LOGS}/explore-raw.json`, JSON.stringify(c.chunks.map((x) => ({ ms: x.t - t0, d: x.d })), null, 1));
console.log('--- tela ---\n' + c.screenText());
console.log('--- hub events ---', JSON.stringify(hub.events.map((e) => [e.kind, e.recvAt - t0])));
c.kill(); process.exit(0);
