/**
 * Diagnosis of the slow server shutdown under load (T21): starts several server instances at once,
 * each with the embedded database, a run with live agents (a PTY and a stream-json one, both of the
 * fake CLI), a viewer on `/ws` and an idle HTTP keep-alive connection, then tells them all to close
 * at the same time and prints how long each phase of the close took and what was still open.
 *
 *   pnpm --filter @neurons/server shutdown:load -- [--instances=4] [--rounds=3] [--burners=0]
 *
 * `--scenario=booting` closes while the agents are still booting (the fake CLI sits on the "trust
 * this folder" dialog nobody answers) instead of while they work.
 *
 * `--burners=N` adds N processes that spin the CPU, to make the machine busier than the instances
 * alone do. Free: only the fake CLI is used. Run it by hand, it is not part of `turbo test`.
 */
import { fork, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { connect, type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const SELF = fileURLToPath(import.meta.url);
const FIXTURE = fileURLToPath(
  new URL("../../../packages/graph-schema/examples/two-terminals.json", import.meta.url),
);
const FAKE_CLAUDE = fileURLToPath(
  new URL("../../../packages/agent-runtimes/test-fixtures/fake-claude.mjs", import.meta.url),
);

interface Timings {
  /** Milliseconds each named phase took, in the order they ended. */
  phases: [string, number][];
  totalMs: number;
  /** What the process still had open when the close ended. */
  open: string;
}

const booting = process.argv.includes("--scenario=booting");

const numberFlag = (name: string, fallback: number): number => {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return raw ? Number(raw.split("=")[1]) : fallback;
};

// ---------------------------------------------------------------------------------------------
// Child: one server instance.
// ---------------------------------------------------------------------------------------------

async function child(): Promise<void> {
  const { createApp } = await import("../src/create-app.js");
  const { loadConfig } = await import("../src/shared/config/app-config.js");
  const { Supervisor } = await import("../src/hub/supervisor.js");
  const { HubLifecycle } = await import("../src/hub/hub-lifecycle.js");
  const { DatabaseService } = await import("../src/database/database.service.js");
  const { EmbeddedRunner } = await import("../src/runners/embedded-runner.js");
  const { RunnerRegistry } = await import("../src/runners/runner-registry.js");
  const { createApiClient } = await import("@neurons/api-client");

  const scratch = await mkdtemp(path.join(os.tmpdir(), "neurons-shutdown-load-"));
  const workdir = path.join(scratch, "work");
  await mkdir(workdir);
  const app = await createApp({
    ...loadConfig({}),
    mode: "all",
    port: 0,
    dataDir: path.join(scratch, "data"),
    database: { kind: "embedded" },
    claudeCommand: { command: process.execPath, args: [FAKE_CLAUDE] },
  });
  await app.listen(0, "127.0.0.1");
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const api = createApiClient(`http://127.0.0.1:${port}`);

  const fixture = JSON.parse(await readFile(FIXTURE, "utf8")) as {
    nodes: { type: string; runtime?: Record<string, unknown> }[];
  };
  const created = await api.POST("/graphs", { body: { name: "Carga" } });
  const graphId = created.data?.id ?? "";
  const definition = {
    ...fixture,
    id: graphId,
    nodes: fixture.nodes.map((node) =>
      node.type === "agent"
        ? {
            ...node,
            runtime: {
              ...node.runtime,
              cwd: workdir,
              ...(booting && { args: ["--trust-dialog"] }),
            },
          }
        : node,
    ),
  };
  const published = await api.POST("/graphs/{id}/versions", {
    params: { path: { id: graphId } },
    body: { definition: definition as never },
  });
  // "Pesquisador" stays busy for a long time, so the close has live agents to stop.
  const started = await api.POST("/runs", {
    body: { graphVersionId: published.data?.id ?? "", input: "!sleep 120000\n!finish nunca" },
  });
  const runId = started.data?.id ?? "";

  // A viewer on /ws, subscribed to the run, and a connection that sent half a request.
  const viewer = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((resolve, reject) => {
    viewer.once("open", resolve);
    viewer.once("error", reject);
  });
  viewer.send(JSON.stringify({ event: "subscribe", data: { runId, fromSeq: 1 } }));
  viewer.on("error", () => undefined);
  const half = connect(port, "127.0.0.1");
  half.on("error", () => undefined);
  half.write("GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");

  // Wait until the agents are really up: the PTY agent is busy.
  const deadline = Date.now() + 60_000;
  for (;;) {
    const events = await api.GET("/runs/{id}/events", {
      params: { path: { id: runId } },
    });
    const items = (events.data as { items?: { type: string; payload: { state?: string } }[] })
      ?.items;
    const wanted = booting ? "starting" : "busy";
    if (items?.some((e) => e.type === "AgentStateChanged" && e.payload.state === wanted)) break;
    if (Date.now() > deadline) throw new Error("os agentes não subiram em 60 s");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  // Time every phase by wrapping what Nest calls while closing.
  const phases: [string, number][] = [];
  const timed = <T extends object>(target: T, method: keyof T & string, name: string) => {
    const original = (target[method] as (...args: unknown[]) => unknown).bind(target);
    (target as Record<string, unknown>)[method] = async (...args: unknown[]) => {
      const t0 = performance.now();
      try {
        return await original(...args);
      } finally {
        phases.push([name, Math.round(performance.now() - t0)]);
      }
    };
  };
  timed(app.get(HubLifecycle), "beforeApplicationShutdown", "agentes (supervisor.stopAll)");
  timed(app.get(DatabaseService), "onApplicationShutdown", "banco (PGlite)");
  timed(app.get(EmbeddedRunner), "onApplicationShutdown", "runner embutido");
  timed(app.get(RunnerRegistry), "onApplicationShutdown", "registro de runners");
  void Supervisor;

  // The fake CLI needs a moment to paint the dialog.
  if (booting) await new Promise((resolve) => setTimeout(resolve, 4_000));
  if (process.argv.includes("--debug-states")) {
    const events = await api.GET("/runs/{id}/events", { params: { path: { id: runId } } });
    const items =
      (
        events.data as {
          items?: { type: string; agent: string | null; payload: { state?: string } }[];
        }
      )?.items ?? [];
    console.log(
      "estados:",
      items
        .filter((e) => e.type === "AgentStateChanged")
        .map((e) => `${e.agent}:${e.payload.state}`)
        .join(", "),
    );
  }
  process.send?.({ ready: true });
  await new Promise<void>((resolve) => process.once("message", () => resolve()));

  const t0 = performance.now();
  await app.close();
  const totalMs = Math.round(performance.now() - t0);
  const counts = new Map<string, number>();
  for (const kind of process.getActiveResourcesInfo())
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const open = [...counts].map(([kind, n]) => `${kind}×${String(n)}`).join(", ");
  const result: Timings = { phases, totalMs, open };
  process.send?.({ result });
  viewer.terminate();
  half.destroy();
  await rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// Parent: several children, closed together.
// ---------------------------------------------------------------------------------------------

function startChild(): Promise<{ proc: ChildProcess; result: Promise<Timings> }> {
  const proc = fork(SELF, ["--child"], { execArgv: ["--import", "tsx"], stdio: "inherit" });
  const result = new Promise<Timings>((resolve, reject) => {
    proc.on(
      "message",
      (message: { result?: Timings }) => message.result && resolve(message.result),
    );
    proc.once("exit", (code) => reject(new Error(`filho saiu com ${String(code)}`)));
  });
  result.catch(() => undefined);
  return new Promise((resolve, reject) => {
    proc.on(
      "message",
      (message: { ready?: boolean }) => message.ready && resolve({ proc, result }),
    );
    proc.once("exit", (code) =>
      reject(new Error(`filho saiu antes de ficar pronto (${String(code)})`)),
    );
  });
}

async function main(): Promise<number> {
  const instances = numberFlag("instances", 4);
  const rounds = numberFlag("rounds", 3);
  const burners = numberFlag("burners", 0);
  const spinners: ChildProcess[] = [];
  for (let i = 0; i < burners; i++) {
    spinners.push(spawn(process.execPath, ["-e", "for(;;){}"], { stdio: "ignore" }));
  }
  const all: Timings[] = [];
  try {
    for (let round = 1; round <= rounds; round++) {
      const children = await Promise.all(Array.from({ length: instances }, startChild));
      console.log(
        `rodada ${String(round)}: ${String(children.length)} instâncias prontas, fechando juntas`,
      );
      for (const { proc } of children) proc.send("close");
      const results = await Promise.all(children.map((c) => c.result));
      for (const timings of results) {
        all.push(timings);
        const phases = timings.phases.map(([name, ms]) => `${name} ${String(ms)} ms`).join("; ");
        console.log(`  total ${String(timings.totalMs)} ms | ${phases} | aberto: ${timings.open}`);
      }
    }
  } finally {
    for (const spinner of spinners) spinner.kill();
  }
  const totals = all.map((t) => t.totalMs).sort((a, b) => a - b);
  console.log(
    `\n${String(totals.length)} fechamentos: mínimo ${String(totals[0])} ms, mediana ${String(totals[Math.floor(totals.length / 2)])} ms, máximo ${String(totals.at(-1))} ms`,
  );
  return 0;
}

if (process.argv.includes("--child")) {
  child().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
} else {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
}
