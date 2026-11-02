/**
 * Manual end-to-end check of the Claude Code runtimes (T08). Runs `two-terminals.json` with the
 * REAL Claude Code: "Pesquisador" (PTY) asks "Revisor" (stream-json), Revisor replies, and
 * Pesquisador calls `finish`. Every prompt spends the logged-in user's subscription, so this is
 * not part of `turbo test`: run it by hand with `pnpm --filter @neurons/server test:e2e:claude`.
 *
 * The Hub, the Supervisor and the run service are the real ones; only the storage is in memory
 * (there is no HTTP API to start a run yet).
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isTerminalRuntime,
  type AgentCommunication,
  type AgentRuntime,
} from "@neurons/agent-runtimes";
import { TerminalRuntimeFactory } from "@neurons/agent-runtimes/claude";
import { validateGraph, type GraphDefinition } from "@neurons/graph-schema";
import { RoutingAgentRuntimeFactory } from "../src/agents/agent-runtime-factory.js";
import { createHubWiring, inMemoryPersistence } from "../src/hub/testing/hub-harness.js";
import type { EphemeralRunEvent, EventSink } from "../src/realtime/run-event.js";
import { loadConfig } from "../src/shared/config/app-config.js";

const FIXTURE = fileURLToPath(
  new URL("../../../packages/graph-schema/examples/two-terminals.json", import.meta.url),
);
const MODEL = "haiku";
// `--claude-debug <folder>` makes each agent's CLI write its hook/MCP debug log there.
const debugFolder = process.argv[process.argv.indexOf("--claude-debug") + 1];
const ASK_TIMEOUT_MS = 180_000;
const RUN_TIMEOUT_MS = 8 * 60_000;
const INPUT = "Tema: o que é um mutex? Faça o resumo de uma frase e valide com o Revisor.";

const config = loadConfig();
const startedAt = Date.now();
const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1).padStart(6)}s`;
const log = (line: string) => console.log(`[${elapsed()}] ${line}`);

/** The CLI arguments of an agent: the cheapest model, plus a debug log when asked for. */
function claudeArgs(agentName: string): string[] {
  const debug = process.argv.includes("--claude-debug")
    ? [
        "--debug",
        "hooks,mcp",
        "--debug-file",
        path.join(debugFolder ?? os.tmpdir(), `${agentName}.log`),
      ]
    : [];
  return ["--model", MODEL, ...debug];
}

/** The CLI may hold its working folder for a moment after it exits (Windows). */
const removeScratch = (folder: string) =>
  rm(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });

async function loadGraph(workdir: string): Promise<GraphDefinition> {
  const checked = validateGraph(JSON.parse(await readFile(FIXTURE, "utf8")));
  if (!checked.ok) throw new Error(`A fixture é inválida: ${JSON.stringify(checked.issues)}`);
  return {
    ...checked.graph,
    nodes: checked.graph.nodes.map((node) =>
      node.type === "agent" && node.runtime.kind === "terminal"
        ? // Cheapest model, and a scratch folder instead of the example path.
          { ...node, runtime: { ...node.runtime, cwd: workdir, args: claudeArgs(node.name) } }
        : node,
    ),
  };
}

/** The last lines of raw terminal output, with the escape sequences stripped (good enough to read). */
const lastLines = (raw: string, count: number): string =>
  raw
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-count)
    .join("\n");

async function main(): Promise<number> {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "neurons-e2e-"));
  const persistence = inMemoryPersistence();
  const factory = new RoutingAgentRuntimeFactory({
    terminal: new TerminalRuntimeFactory({
      askTimeoutMs: ASK_TIMEOUT_MS,
      cli: { ...(config.claudeBin && { configuredBinary: config.claudeBin }) },
      logger: { warn: (m) => log(`AVISO ${m}`), error: (m) => log(`ERRO ${m}`) },
      // The scratch folder is created empty by this script, so trusting it is safe.
      terminal: { trustWorkingDirectory: true },
    }),
  });
  if (process.argv.includes("--boot-only")) return bootOnly(factory, workdir);
  const wiring = createHubWiring(persistence, factory, { hub: { askTimeoutMs: ASK_TIMEOUT_MS } });

  try {
    const graph = await loadGraph(workdir);
    const version = await persistence.versions.appendNext(graph.id, graph);
    const run = await wiring.runService.start(version.id, INPUT);
    log(`execução ${run.id} iniciada (modelo ${MODEL}, pasta ${workdir})`);

    // Print the run log as it grows, until the run ends.
    let printed = 0;
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let finished = false;
    while (!finished && Date.now() < deadline) {
      for (const event of wiring.published.slice(printed)) {
        log(describe(event.type, event.agent, event.payload));
        finished ||= event.type === "RunFinished";
      }
      printed = wiring.published.length;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!finished) log("TEMPO ESGOTADO: a execução não terminou.");

    return report(wiring.published, finished) ? 0 : 1;
  } finally {
    // Whatever happened, show what the PTY agent's screen ended with, then clean up.
    const screens: EphemeralRunEvent[] = [];
    const sink: EventSink = {
      send: () => undefined,
      sendEphemeral: (event) => screens.push(event),
    };
    const runId = wiring.published[0]?.runId;
    if (runId) wiring.terminals.replayTo(sink, runId);
    for (const screen of screens) {
      log(`fim da tela de ${screen.agent}:\n${lastLines(screen.data, 12)}`);
    }
    // The run may already be ending on its own: this waits for that to finish before exiting.
    if (runId) await wiring.supervisor.stopRun(runId);
    else await wiring.supervisor.stopAll();
    await removeScratch(workdir);
  }
}

/**
 * Preflight: starts each agent and stops it again. Without `--probe` no prompt is sent and nothing
 * is spent; with it, each agent gets ONE one-line message and the script waits for its turn to end.
 */
async function bootOnly(factory: RoutingAgentRuntimeFactory, workdir: string): Promise<number> {
  const graph = await loadGraph(workdir);
  let failed = false;
  try {
    for (const node of graph.nodes) {
      if (node.type !== "agent") continue;
      const runtime = factory.create(node, {} as AgentCommunication);
      const screens: string[] = [];
      if (isTerminalRuntime(runtime)) runtime.onOutput((chunk) => screens.push(chunk));
      const t0 = Date.now();
      try {
        await runtime.start(`# Você é "${node.name}"`);
        log(
          `${node.name}: pronto em ${((Date.now() - t0) / 1000).toFixed(1)} s (${runtime.state})`,
        );
        if (process.argv.includes("--probe")) await probe(runtime, node.name);
      } catch (error) {
        failed = true;
        log(`${node.name}: FALHOU: ${error instanceof Error ? error.message : String(error)}`);
        log(`tela:
${lastLines(screens.join(""), 15)}`);
      } finally {
        await runtime.stop();
      }
    }
  } finally {
    await removeScratch(workdir);
  }
  return failed ? 1 : 0;
}

/** One cheap turn: proves a message is accepted, answered, and that the end of the turn is noticed. */
async function probe(runtime: AgentRuntime, name: string): Promise<void> {
  const idle = new Promise<void>((resolve) => {
    runtime.onStateChange((state) => state === "idle" && resolve());
  });
  const t0 = Date.now();
  await runtime.deliver({
    id: "probe-1",
    from: "@human",
    kind: "message",
    body: "Responda apenas a palavra: ok",
    replyTo: null,
  });
  log(`${name}: mensagem aceita em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await Promise.race([idle, new Promise((resolve) => setTimeout(resolve, 120_000))]);
  log(
    `${name}: turno terminou em ${((Date.now() - t0) / 1000).toFixed(1)} s (estado ${runtime.state})`,
  );
}

function describe(type: string, agent: string | null, payload: unknown): string {
  const data = payload as Record<string, unknown>;
  const text = (value: unknown) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .slice(0, 160);
  switch (type) {
    case "MessageSent":
      return `${text(data.from)} -> ${text(data.to)} [${text(data.kind)}] ${text(data.body)}`;
    case "UsageRecorded":
      return `uso de ${agent ?? "?"}: US$ ${text(data.costUsd)} em ${text(data.durationMs)} ms (${text(data.inputTokens)} entrada / ${text(data.outputTokens)} saída)`;
    case "AgentFailed":
      return `FALHA de ${agent ?? "?"}: ${text(data.reason)}`;
    case "RunFinished":
      return `execução encerrada (${text(data.reason)}) por ${text(data.agent)}: ${text(data.result)}`;
    default:
      return `${type}${agent ? ` (${agent})` : ""}`;
  }
}

interface Logged {
  type: string;
  agent: string | null;
  payload: unknown;
  at: Date;
}

/** Prints the summary and says whether the conversation happened as designed. */
function report(events: Logged[], finished: boolean): boolean {
  const sent = events.filter((e) => e.type === "MessageSent");
  const body = (e: Logged) => e.payload as { from: string; to: string; kind: string };
  const ask = sent.find((e) => body(e).from === "Pesquisador" && body(e).kind === "ask");
  const reply = sent.find((e) => body(e).from === "Revisor" && body(e).kind === "reply");
  const end = events.find((e) => e.type === "RunFinished");
  const reason = (end?.payload as { reason?: string } | undefined)?.reason;
  const usages = events.filter((e) => e.type === "UsageRecorded");
  const cost = usages.reduce(
    (sum, e) => sum + ((e.payload as { costUsd?: number }).costUsd ?? 0),
    0,
  );
  const failures = events.filter((e) => e.type === "AgentFailed");

  console.log("\n==== Resumo ====");
  console.log(`ask do Pesquisador ao Revisor: ${ask ? "sim" : "NÃO"}`);
  console.log(`reply do Revisor: ${reply ? "sim" : "NÃO"}`);
  if (ask && reply) {
    console.log(`ask -> reply: ${((reply.at.getTime() - ask.at.getTime()) / 1000).toFixed(1)} s`);
  }
  console.log(
    `encerrada por finish: ${reason === "finished" ? "sim" : `NÃO (${reason ?? "não encerrou"})`}`,
  );
  console.log(`tempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
  console.log(
    `custo informado pelo stream-json (${usages.length} turno(s)): US$ ${cost.toFixed(4)}`,
  );
  console.log(`falhas de agente: ${failures.length}`);
  return (
    finished && Boolean(ask) && Boolean(reply) && reason === "finished" && failures.length === 0
  );
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
