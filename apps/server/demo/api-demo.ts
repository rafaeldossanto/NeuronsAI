/**
 * Demo and acceptance test of the public API (T10): starts the server in this process, publishes
 * `two-terminals.json` and runs it through the HTTP API, printing every event as it arrives over
 * the WebSocket. The exit code says whether the run did what the graph promises.
 *
 *   pnpm --filter @neurons/server demo                 fake Claude Code CLI: free, takes seconds
 *   pnpm --filter @neurons/server demo -- --real-claude  the real CLI: spends the subscription quota
 *   pnpm --filter @neurons/server demo -- --profile=hybrid  the same run, with the agents in a runner
 *                                          that is another process and connects by WebSocket
 *
 * While "Pesquisador" works, the demo also types into its terminal over the WebSocket
 * (`terminal.input`) and tries the same on "Revisor", which has no terminal to type into: the
 * answer must be `error { code: "not_a_terminal" }`.
 *
 * Both agents are terminals ("Pesquisador" asks "Revisor", who answers, then "Pesquisador" calls
 * `finish`). The fake CLI works on directive lines in the prompt (see
 * packages/agent-runtimes/test-fixtures/fake-claude.mjs), so the first message carries them. The
 * real CLI gets a plain request; it is run with the cheapest model and, being headless, without the
 * "trust this folder" dialog a PTY would stop at. Run it once, not in a loop.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { createApiClient } from "@neurons/api-client";
import { WebSocket } from "ws";
import { createApp } from "../src/create-app.js";
import { RunnerRegistry } from "../src/runners/runner-registry.js";
import { RunnerTokens } from "../src/runners/runner-tokens.service.js";
import { loadConfig, type AppConfig } from "../src/shared/config/app-config.js";

const FIXTURE = fileURLToPath(
  new URL("../../../packages/graph-schema/examples/two-terminals.json", import.meta.url),
);
const FAKE_CLAUDE = fileURLToPath(
  new URL("../../../packages/agent-runtimes/test-fixtures/fake-claude.mjs", import.meta.url),
);

const RUNNER_PROCESS = fileURLToPath(new URL("./runner-process.ts", import.meta.url));
const SERVER_DIR = fileURLToPath(new URL("..", import.meta.url));

const realClaude = process.argv.includes("--real-claude");
const profile = process.argv.includes("--profile=hybrid") ? "hybrid" : "local";
const RUN_TIMEOUT_MS = realClaude ? 8 * 60_000 : 90_000;

/** What the first message says: directives for the fake CLI, a plain request for the real one. */
const INPUT = realClaude
  ? "Tema: o que é um mutex? Faça o resumo de uma frase e valide com o Revisor."
  : "!sleep 1500\n!ask Revisor !reply certo\n!finish resumo validado: $last";

const startedAt = Date.now();
const log = (line: string) =>
  console.log(`[${((Date.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}`);

const oneLine = (value: unknown, max = 140): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .slice(0, max);

function describeEvent(type: string, agent: string | null, payload: unknown): string {
  const data = (payload ?? {}) as Record<string, unknown>;
  switch (type) {
    case "MessageSent":
      return `${oneLine(data.from)} -> ${oneLine(data.to)} [${oneLine(data.kind)}] ${oneLine(data.body)}`;
    case "AgentStateChanged":
      return `${agent ?? "?"} -> ${oneLine(data.state)}${data.reason ? ` (${oneLine(data.reason)})` : ""}`;
    case "ToolCalled":
      return `${agent ?? "?"} usou ${oneLine(data.tool)} em ${oneLine(data.durationMs)} ms (${data.ok ? "ok" : `erro ${oneLine(data.errorCode)}`}): ${oneLine(data.inputSummary, 80)}`;
    case "UsageRecorded":
      return `${agent ?? "?"} gastou US$ ${data.costUsd === null ? "(custo desconhecido)" : oneLine(data.costUsd)}`;
    case "RunFinished":
      return `fim: ${oneLine(data.reason)} ${oneLine(data.result ?? data.message ?? data.error ?? "")}`;
    case "AgentFailed":
      return `${agent ?? "?"} falhou: ${oneLine(data.reason)}`;
    case "GuardTripped":
    case "GuardWarning":
      return `${oneLine(data.guard)}: ${oneLine(data.reason ?? data.message)}`;
    default:
      return `${agent ?? ""} ${oneLine(JSON.stringify(data), 80)}`.trim();
  }
}

interface WireEvent {
  event: string;
  data: { seq?: number; type?: string; agent?: string | null; payload?: unknown; data?: string };
}

/** Prints the run log as it arrives; resolves with the event types seen once the run finished. */
function watch(port: number, runId: string, seen: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    let terminalBytes = 0;
    let typed = false;
    const say = (event: string, data: unknown) => socket.send(JSON.stringify({ event, data }));
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`A execução não terminou em ${RUN_TIMEOUT_MS / 1000} s.`));
    }, RUN_TIMEOUT_MS);

    socket.on("open", () =>
      socket.send(JSON.stringify({ event: "subscribe", data: { runId, fromSeq: 1 } })),
    );
    socket.on("error", reject);
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as WireEvent;
      if (message.event === "run.ephemeral") {
        terminalBytes += message.data.data?.length ?? 0;
        return;
      }
      if (message.event === "error") {
        // The one refusal this demo asks for; anything else is a real problem.
        const code = (message.data as { code?: string }).code;
        if (code !== "not_a_terminal") return reject(new Error(JSON.stringify(message.data)));
        seen.push("error:not_a_terminal");
        return log(`terminal.input recusado como esperado: ${JSON.stringify(message.data)}`);
      }
      if (message.event !== "run.event") return;
      const { seq, type = "?", agent = null, payload } = message.data;
      seen.push(type);
      log(`#${String(seq).padStart(2)} ${type.padEnd(15)} ${describeEvent(type, agent, payload)}`);
      const state = (payload as { state?: string } | undefined)?.state;
      if (type === "AgentStateChanged" && agent === "Pesquisador" && state === "busy" && !typed) {
        typed = true;
        log("digitando no terminal do Pesquisador e no do Revisor (que não tem terminal)");
        say("terminal.input", { runId, agent: "Pesquisador", data: "x" });
        say("terminal.input", { runId, agent: "Revisor", data: "x" });
      }
      if (type === "RunFinished") {
        clearTimeout(timer);
        log(`saída de terminal recebida pelo WebSocket: ${terminalBytes} caracteres`);
        socket.close();
        resolve();
      }
    });
  });
}

/** The fixture, ready to run here: a fresh id, a scratch folder as the agents' cwd, the demo's models. */
async function loadGraph(graphId: string, workdir: string) {
  const fixture = JSON.parse(await readFile(FIXTURE, "utf8")) as {
    id: string;
    nodes: { type: string; runtime?: Record<string, unknown> }[];
  };
  return {
    ...fixture,
    id: graphId,
    nodes: fixture.nodes.map((node) => {
      if (node.type !== "agent" || !node.runtime) return node;
      const runtime = {
        ...node.runtime,
        cwd: workdir,
        ...(realClaude && { mode: "stream-json", args: ["--model", "haiku"] }),
      };
      return { ...node, runtime };
    }),
  };
}

function demoConfig(dataDir: string): AppConfig {
  // The real run reads NEURONS_CLAUDE_BIN etc. from the environment, through the config module.
  const base = loadConfig(realClaude ? undefined : {});
  return {
    ...base,
    mode: "all",
    profile,
    port: 0,
    dataDir,
    database: { kind: "embedded" },
    askTimeoutMs: realClaude ? 180_000 : 60_000,
    // In `hybrid` the CLI belongs to the runner process, which gets the fake on its command line.
    ...(!realClaude &&
      profile === "local" && { claudeCommand: { command: process.execPath, args: [FAKE_CLAUDE] } }),
  };
}

/** `hybrid`: issues a token and starts the runner as a separate process that connects by WebSocket. */
async function startRemoteRunner(
  app: Awaited<ReturnType<typeof createApp>>,
  port: number,
): Promise<ChildProcess> {
  const { token } = await app.get(RunnerTokens).issue("demo");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", RUNNER_PROCESS, ...(realClaude ? [] : ["--fake-claude", FAKE_CLAUDE])],
    {
      cwd: SERVER_DIR,
      stdio: ["pipe", "inherit", "inherit"],
      env: {
        ...process.env,
        NEURONS_SERVER_URL: `http://127.0.0.1:${port}`,
        NEURONS_RUNNER_TOKEN: token,
        NEURONS_RUNNER_NAME: "demo",
      },
    },
  );
  const registry = app.get(RunnerRegistry);
  for (let waited = 0; registry.connected().length === 0; waited += 100) {
    if (waited > 30_000) throw new Error("O runner não se conectou em 30 s.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  log(`runner conectado (processo ${child.pid}, outro processo que este servidor)`);
  return child;
}

/** Asks the runner to leave (its stdin closes) and waits; kills it only if it does not. */
async function stopRemoteRunner(child: ChildProcess): Promise<void> {
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.stdin?.end();
  const timer = setTimeout(() => child.kill(), 15_000);
  await exited;
  clearTimeout(timer);
}

/** The CLI may hold its working folder for a moment after it exits (Windows). */
const removeScratch = (folder: string) =>
  rm(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });

async function main(): Promise<number> {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "neurons-demo-"));
  const workdir = path.join(scratch, "work");
  await mkdir(workdir);
  const app = await createApp(demoConfig(path.join(scratch, "data")));
  let runner: ChildProcess | undefined;
  try {
    await app.listen(0, "127.0.0.1");
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const api = createApiClient(`http://127.0.0.1:${port}`);
    log(
      `servidor em http://127.0.0.1:${port} (perfil ${profile}, CLI ${realClaude ? "REAL" : "de mentira"})`,
    );
    if (profile === "hybrid") runner = await startRemoteRunner(app, port);

    const created = await api.POST("/graphs", { body: { name: "Demo: dois terminais" } });
    if (!created.data) throw new Error(`POST /graphs: ${JSON.stringify(created.error)}`);
    const graphId = created.data.id;

    const published = await api.POST("/graphs/{id}/versions", {
      params: { path: { id: graphId } },
      // The fixture is plain JSON; the API validates it against the graph schema.
      body: { definition: (await loadGraph(graphId, workdir)) as never },
    });
    if (!published.data) throw new Error(`POST versions: ${JSON.stringify(published.error)}`);
    log(`grafo ${graphId} publicado: versão ${published.data.version}`);

    const started = await api.POST("/runs", {
      body: { graphVersionId: published.data.id, input: INPUT },
    });
    if (!started.data) throw new Error(`POST /runs: ${JSON.stringify(started.error)}`);
    const runId = started.data.id;
    log(`execução ${runId} iniciada`);

    const seen: string[] = [];
    await watch(port, runId, seen);

    const detail = await api.GET("/runs/{id}", { params: { path: { id: runId } } });
    log(
      `resultado: ${JSON.stringify({ status: detail.data?.status, finish: detail.data?.finish, usage: detail.data?.usage.total })}`,
    );
    const ok =
      detail.data?.status === "succeeded" &&
      detail.data.finish?.reason === "finished" &&
      seen.includes("MessageSent") &&
      seen.includes("MessageDelivered") &&
      seen.includes("AgentStateChanged") &&
      (realClaude || seen.includes("error:not_a_terminal"));
    log(
      ok
        ? "OK: a execução terminou como o grafo promete."
        : "FALHOU: a execução não terminou como esperado.",
    );
    return ok ? 0 : 1;
  } finally {
    // Stops every agent the run left behind, then the runner, the server and the scratch folder.
    await app.close();
    if (runner) await stopRemoteRunner(runner);
    await removeScratch(scratch);
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
