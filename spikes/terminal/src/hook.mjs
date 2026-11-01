// Hook do Claude Code: repassa o evento (JSON do stdin) para o Hub local do spike.
const url = process.env.NEURONS_HUB_URL;
const event = process.argv[2] ?? 'unknown';
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
if (!url) process.exit(0);
let payload = {};
try {
  payload = JSON.parse(raw);
} catch {
  payload = { raw };
}
try {
  await fetch(`${url}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event, at: Date.now(), payload }),
  });
} catch {
  // o spike pode ja ter encerrado; hook nunca deve falhar a CLI
}
