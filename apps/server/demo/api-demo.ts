/**
 * Demo and acceptance test of the public API (T10): starts the server in this process, publishes
 * `two-terminals.json` and runs it through the HTTP API, printing every event as it arrives over
 * the WebSocket. The exit code says whether the run did what the graph promises.
 *
 *   pnpm --filter @neurons/server demo                 fake Claude Code CLI: free, takes seconds
 *   pnpm --filter @neurons/server demo -- --real-claude  the real CLI: spends the subscription quota
 *
 * Both agents are terminals ("Pesquisador" asks "Revisor", who answers, then "Pesquisador" calls
 * `finish`). The fake CLI works on directive lines in the prompt (see
 * packages/agent-runtimes/test-fixtures/fake-claude.mjs), so the first message carries them. The
 * real CLI gets a plain request; it is run with the cheapest model and, being headless, without the
 * "trust this folder" dialog a PTY would stop at. Run it once, not in a loop.
 */
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { createApiClient } from "@neurons/api-client";
import { WebSocket } from "ws";
import { createApp } from "../src/create-app.js";
import { loadConfig, type AppConfig } from "../src/shared/config/app-config.js";

const FIXTURE = fileURLToPath(
  new URL("../../../packages/graph-schema/examples/two-terminals.json", import.meta.url),
);
const FAKE_CLAUDE = fileURLToPath(
  new URL("../../../packages/agent-runtimes/test-fixtures/fake-claude.mjs", import.meta.url),
);

const realClaude = process.argv.includes("--real-claude");
const RUN_TIMEOUT_MS = realClaude ? 8 * 60_000 : 90_000;

/** What the first message says: directives for the fake CLI, a plain request for the real one. */
const INPUT = realClaude
  ? "Tema: o que é um mutex? Faça o resumo de uma frase e valide com o Revisor."
  : "!ask Revisor !reply certo\n!finish resumo validado: $last";

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
      if (message.event === "error") return reject(new Error(JSON.stringify(message.data)));
      if (message.event !== "run.event") return;
      const { seq, type = "?", agent = null, payload } = message.data;
      seen.push(type);
      log(`#${String(seq).padStart(2)} ${type.padEnd(15)} ${describeEvent(type, agent, payload)}`);
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
    port: 0,
    dataDir,
    database: { kind: "embedded" },
    askTimeoutMs: realClaude ? 180_000 : 60_000,
    ...(!realClaude && { claudeCommand: { command: process.execPath, args: [FAKE_CLAUDE] } }),
  };
}

/** The CLI may hold its working folder for a moment after it exits (Windows). */
const removeScratch = (folder: string) =>
  rm(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });

async function main(): Promise<number> {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "neurons-demo-"));
  const workdir = path.join(scratch, "work");
  await mkdir(workdir);
  const app = await createApp(demoConfig(path.join(scratch, "data")));
  try {
    await app.listen(0, "127.0.0.1");
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const api = createApiClient(`http://127.0.0.1:${port}`);
    log(`servidor em http://127.0.0.1:${port} (CLI ${realClaude ? "REAL" : "de mentira"})`);

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
      seen.includes("MessageDelivered");
    log(
      ok
        ? "OK: a execução terminou como o grafo promete."
        : "FALHOU: a execução não terminou como esperado.",
    );
    return ok ? 0 : 1;
  } finally {
    // Stops every agent the run left behind, then the server, then the scratch folder.
    await app.close();
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
