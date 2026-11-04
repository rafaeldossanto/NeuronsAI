// Acceptance test of the desktop app: starts the real Electron app (from source, or the executable
// that `electron-builder --dir` produced), with the fake Claude Code CLI and an empty data folder,
// and runs `two-terminals.json` through the app's own server, as the interface would.
//
//   pnpm --filter @neurons/desktop smoke                        from source (needs `build`)
//   pnpm --filter @neurons/desktop smoke -- path/to/NeuronsAI   the packaged app
//
// Needs the web interface, the server and this package built. The exit code says whether it worked.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const FIXTURE = path.join(root, "packages", "graph-schema", "examples", "two-terminals.json");
const FAKE_CLAUDE = path.join(
  root,
  "packages",
  "agent-runtimes",
  "test-fixtures",
  "fake-claude.mjs",
);
const DEBUG_PORT = 9333 + Math.floor(Math.random() * 500);
const packagedExecutable = process.argv.slice(2).find((argument) => argument !== "--");

const log = (line) => console.log(`[smoke] ${line}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(label, probe, timeoutMs) {
  const limit = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => undefined);
    if (value) return value;
    if (Date.now() > limit) throw new Error(`Tempo esgotado: ${label}`);
    await sleep(250);
  }
}

async function main() {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "neurons-smoke-"));
  const dataDir = path.join(scratch, "data");
  const workdir = path.join(scratch, "work");
  await mkdir(workdir);

  const command = packagedExecutable ?? createRequire(import.meta.url)("electron");
  const args = [
    ...(packagedExecutable ? [] : [path.resolve(here, "..")]),
    `--remote-debugging-port=${DEBUG_PORT}`,
  ];
  const env = {
    ...process.env,
    NEURONS_DATA_DIR: dataDir,
    NEURONS_DESKTOP_CLAUDE_COMMAND: process.execPath,
    NEURONS_DESKTOP_CLAUDE_ARGS: JSON.stringify([FAKE_CLAUDE]),
  };
  delete env.ELECTRON_RUN_AS_NODE;

  log(`abrindo ${packagedExecutable ?? "electron (do código-fonte)"}`);
  const app = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  app.stdout.on("data", (chunk) => (output += chunk));
  app.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) => app.once("exit", (code) => resolve(code)));

  try {
    const page = await until(
      "a janela abrir",
      async () => {
        const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
        return targets.find(
          (target) => target.type === "page" && target.url.startsWith("http://127.0.0.1:"),
        );
      },
      60_000,
    );
    const origin = new URL(page.url).origin;
    log(`janela em ${origin}`);

    const html = await fetch(origin);
    const csp = html.headers.get("content-security-policy") ?? "";
    if (!html.ok || !csp.includes("default-src 'self'"))
      throw new Error("A interface não veio com a CSP.");
    log("interface servida com CSP restritiva");

    const outside = await fetch(`${origin.replace("127.0.0.1", "localhost")}/api/health`).catch(
      () => undefined,
    );
    if (outside) log(`(localhost também responde: ${outside.status})`);

    const api = async (method, url, body) => {
      const response = await fetch(`${origin}/api${url}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body && { body: JSON.stringify(body) }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(`${method} ${url}: ${response.status} ${JSON.stringify(data)}`);
      return data;
    };

    const health = await api("GET", "/health");
    log(`banco: ${health.database.type} (${health.database.status})`);

    const graph = JSON.parse(await readFile(FIXTURE, "utf8"));
    const created = await api("POST", "/graphs", { name: "Smoke: dois terminais" });
    graph.id = created.id;
    for (const node of graph.nodes) if (node.type === "agent") node.runtime.cwd = workdir;
    const version = await api("POST", `/graphs/${created.id}/versions`, { definition: graph });
    const run = await api("POST", "/runs", {
      graphVersionId: version.id,
      input: "!ask Revisor !reply certo\n!finish resumo validado: $last",
    });
    log(`execução ${run.id} iniciada`);

    const finished = await until(
      "a execução terminar",
      async () => {
        const detail = await api("GET", `/runs/${run.id}`);
        return ["succeeded", "failed", "stopped"].includes(detail.status) ? detail : undefined;
      },
      90_000,
    );
    const events = await api("GET", `/runs/${run.id}/events?limit=200`);
    const types = (events.items ?? events).map((event) => event.type);
    log(`status ${finished.status}; eventos: ${[...new Set(types)].join(", ")}`);
    if (finished.status !== "succeeded" || !types.includes("MessageSent")) {
      throw new Error(`A execução não terminou como esperado:\n${JSON.stringify(finished)}`);
    }

    // The data folder is locked while the app runs.
    const lock = path.join(dataDir, "db.lock");
    await stat(lock);
    log("trava do banco presente enquanto o app roda");

    return { scratch, app, exited, ok: true };
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(`--- saída do app ---\n${output.slice(-3000)}`);
    return { scratch, app, exited, ok: false };
  }
}

const { scratch, app, exited, ok } = await main();
// Ask the app to quit the way a user would, so the server shuts down cleanly (`Browser.close`).
try {
  const { webSocketDebuggerUrl } = await (
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
  ).json();
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
} catch {
  app.kill();
}
const timer = setTimeout(() => {
  log("o app não saiu sozinho; encerrando à força");
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(app.pid), "/T", "/F"]);
  else app.kill("SIGKILL");
}, 20_000);
await exited;
clearTimeout(timer);
let released = false;
try {
  await stat(path.join(scratch, "data", "db.lock"));
} catch {
  released = true;
}
log(released ? "trava do banco liberada ao sair" : "ATENÇÃO: a trava do banco ficou para trás");
await rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
log(ok && released ? "OK" : "FALHOU");
process.exitCode = ok && released ? 0 : 1;
