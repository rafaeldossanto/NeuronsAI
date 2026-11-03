import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { MCP_SERVER_NAME } from "@neurons/mcp-neurons";
import { z } from "zod";
import type { InboundMessage } from "../contract/agent-runtime.js";
import type { AgentUsage } from "../contract/usage.js";
import { killProcessTree } from "../platform/process-tree.js";
import { settlesWithin, waitUntil } from "./async.js";
import { ClaudeRuntimeBase, errorMessage, type LaunchContext } from "./claude-runtime-base.js";
import { formatInboundMessage } from "./inbound-text.js";

const STDERR_TAIL_CHARS = 500;
const BUDGET_EXHAUSTED = "error_max_budget_usd";
const DRAIN_POLL_MS = 25;

const counter = z.number().optional();

/**
 * `total_cost_usd` of a `result` event is the cost of the whole session so far, not of that turn
 * (measured with the real CLI, 2.1.309: two turns of a Haiku session reported 0.0006 and 0.0018,
 * and `modelUsage` adds up the tokens of every turn). The Hub sums the costs of the turns, so each
 * turn reports the difference. A total that went down means the counter restarted: the new value
 * is all there is.
 */
export function costOfTurn(sessionTotal: number, previousTotal: number): number {
  const turn = sessionTotal >= previousTotal ? sessionTotal - previousTotal : sessionTotal;
  return Math.round(turn * 1e10) / 1e10; // subtracting floats leaves dust that would show in the log
}

const initEvent = z.object({
  type: z.literal("system"),
  subtype: z.literal("init"),
  model: z.string().optional(),
  mcp_servers: z.array(z.object({ name: z.string(), status: z.string() })).optional(),
});

/** The explicit end of a turn, with what it cost. */
const resultEvent = z.object({
  type: z.literal("result"),
  subtype: z.string().optional(),
  is_error: z.boolean().optional(),
  duration_ms: counter,
  num_turns: counter,
  total_cost_usd: counter,
  usage: z
    .object({
      input_tokens: counter,
      output_tokens: counter,
      cache_read_input_tokens: counter,
      cache_creation_input_tokens: counter,
    })
    .optional(),
  modelUsage: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Claude Code as a persistent headless session: `claude -p --input-format stream-json
 * --output-format stream-json`. A message is one JSON line on stdin; the `result` event is the
 * explicit end of the turn and carries the usage and cost. There is no screen to watch.
 */
export class ClaudeStreamJsonRuntime extends ClaudeRuntimeBase {
  protected readonly mode = "stream-json";
  readonly reportsCost = true;

  private child: ChildProcessWithoutNullStreams | undefined;
  private exited: Promise<void> = Promise.resolve();
  private stderrTail = "";
  private model: string | undefined;
  /** The session total the last `result` event reported. */
  private sessionCostUsd = 0;

  get processId(): number | undefined {
    return this.child?.pid;
  }

  async deliver(message: InboundMessage): Promise<void> {
    if (this.state !== "idle") {
      throw new Error(`O agente "${this.agent.name}" não está ocioso (${this.state}).`);
    }
    this.setState("busy");
    try {
      await this.writeLine({
        type: "user",
        message: { role: "user", content: formatInboundMessage(message) },
      });
    } catch (error) {
      this.fail(`Não foi possível enviar a mensagem ao Claude Code: ${errorMessage(error)}`);
      throw error;
    }
  }

  protected async launch({ command, args, env, cwd }: LaunchContext): Promise<void> {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // Its own process group, so the whole tree can be signalled on macOS/Linux.
      detached: this.deps.cli.platform !== "win32",
    });
    this.child = child;
    this.exited = new Promise((resolve) => {
      child.once("exit", (code) => {
        resolve();
        if (!this.lifetime.signal.aborted) this.fail(this.unexpectedExit(code));
      });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_CHARS);
    });
    // Writing to a dead process surfaces here and in the write callback; both end as a failure.
    child.stdin.on("error", () => undefined);
    createInterface({ input: child.stdout }).on("line", (line) => void this.onLine(line));

    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
  }

  /** The `result` event closes the turn and carries its usage: wait for it, up to the flush window. */
  protected override async drain(flushMs: number): Promise<void> {
    await waitUntil(() => this.state !== "busy" && this.state !== "waiting_reply", {
      timeoutMs: flushMs,
      signal: this.lifetime.signal,
      pollMs: DRAIN_POLL_MS,
    });
  }

  protected async terminate(): Promise<void> {
    const child = this.child;
    if (!child?.pid) return;
    child.stdin.end();
    await killProcessTree(child.pid, this.deps.cli.platform);
    await settlesWithin(this.exited, 5_000);
    // The process is gone, but a pipe whose end was queued behind a dead reader would keep this
    // process from ever exiting (a server that was asked to shut down would hang).
    child.stdin.destroy();
  }

  // ---- events ----

  private async onLine(line: string): Promise<void> {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return; // not an event (a stray log line)
    }
    try {
      const init = initEvent.safeParse(event);
      if (init.success) this.onInit(init.data);
      const result = resultEvent.safeParse(event);
      if (result.success) await this.onResult(result.data);
    } catch (error) {
      this.deps.logger.error(
        `Falha ao tratar um evento do agente "${this.agent.name}": ${errorMessage(error)}`,
      );
    }
  }

  private onInit(event: z.infer<typeof initEvent>): void {
    this.model = event.model;
    const neurons = event.mcp_servers?.find((server) => server.name === MCP_SERVER_NAME);
    if (neurons && neurons.status !== "connected") {
      this.fail(
        `O Claude Code não conseguiu conectar o MCP do Neurons (${neurons.status}); o agente não consegue conversar.`,
      );
    }
  }

  private async onResult(event: z.infer<typeof resultEvent>): Promise<void> {
    try {
      await this.reportUsage(toUsage(event, this.model, this.takeTurnCost(event)));
    } catch (error) {
      // The run may already be over; a missing cost record must not take the agent down.
      this.deps.logger.warn(
        `Não foi possível registrar o uso do agente "${this.agent.name}": ${errorMessage(error)}`,
      );
    }

    if (event.subtype === BUDGET_EXHAUSTED) {
      this.fail(`O agente "${this.agent.name}" esgotou o orçamento configurado.`);
      return;
    }
    if (event.is_error) {
      this.deps.logger.warn(
        `O turno do agente "${this.agent.name}" terminou com erro (${event.subtype ?? "sem detalhe"}).`,
      );
    }
    if (this.state === "busy" || this.state === "waiting_reply") this.setState("idle");
  }

  /** The cost of the turn that just ended, out of the session total its `result` event carries. */
  private takeTurnCost(event: z.infer<typeof resultEvent>): number | undefined {
    if (event.total_cost_usd === undefined) return undefined;
    const cost = costOfTurn(event.total_cost_usd, this.sessionCostUsd);
    this.sessionCostUsd = event.total_cost_usd;
    return cost;
  }

  // ---- stdin ----

  private writeLine(payload: unknown): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) return Promise.reject(new Error("O processo já terminou."));
    return new Promise((resolve, reject) => {
      stdin.write(`${JSON.stringify(payload)}\n`, (error) => (error ? reject(error) : resolve()));
    });
  }

  private unexpectedExit(code: number | null): string {
    const detail = this.stderrTail.trim();
    return `O Claude Code encerrou de forma inesperada (código ${code ?? "?"}).${detail ? ` ${detail}` : ""}`;
  }
}

function toUsage(
  event: z.infer<typeof resultEvent>,
  model: string | undefined,
  costUsd: number | undefined,
): AgentUsage {
  const usage = event.usage;
  const modelName = model ?? Object.keys(event.modelUsage ?? {})[0];
  return {
    ...(modelName && { model: modelName }),
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
    ...(costUsd !== undefined && { costUsd }),
    ...(event.duration_ms !== undefined && { durationMs: event.duration_ms }),
    ...(event.num_turns !== undefined && { turns: event.num_turns }),
  };
}
