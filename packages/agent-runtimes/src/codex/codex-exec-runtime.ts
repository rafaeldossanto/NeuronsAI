import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { MCP_SERVER_NAME } from "@neurons/mcp-neurons";
import { z } from "zod";
import { errorMessage, type LaunchContext } from "../cli/cli-runtime-base.js";
import type { InboundMessage } from "../contract/agent-runtime.js";
import {
  OutputBatcher,
  messageFieldOf,
  type OutputDelta,
  type StreamingAgentRuntime,
} from "../contract/output-stream.js";
import { Signal, type Unsubscribe } from "../contract/signal.js";
import type { AgentUsage } from "../contract/usage.js";
import { killProcessTree } from "../platform/process-tree.js";
import { settlesWithin, waitUntil } from "../claude/async.js";
import { formatInboundMessage } from "../claude/inbound-text.js";
import { buildCodexArgs } from "./codex-args.js";
import { CodexRuntimeBase } from "./codex-runtime-base.js";

const STDERR_TAIL_CHARS = 500;
const DRAIN_POLL_MS = 25;

const counter = z.number().optional();

const usageSchema = z.object({
  input_tokens: counter,
  cached_input_tokens: counter,
  cache_write_input_tokens: counter,
  output_tokens: counter,
  reasoning_output_tokens: counter,
});

/** The events of `codex exec --json` (JSONL): only what the runtime reads; the rest is ignored. */
const threadStarted = z.object({ type: z.literal("thread.started"), thread_id: z.string() });
const turnCompleted = z.object({
  type: z.literal("turn.completed"),
  usage: usageSchema.optional(),
});
const turnFailed = z.object({
  type: z.literal("turn.failed"),
  error: z.object({ message: z.string().optional() }).optional(),
});
const errorEvent = z.object({ type: z.literal("error"), message: z.string().optional() });
const itemEvent = z.object({
  type: z.enum(["item.started", "item.updated", "item.completed"]),
  item: z
    .object({
      id: z.string(),
      type: z.string(),
      text: z.string().optional(),
      server: z.string().optional(),
      tool: z.string().optional(),
      arguments: z.unknown().optional(),
      status: z.string().optional(),
      exit_code: z.number().nullable().optional(),
    })
    .loose(),
});

type CodexItem = z.infer<typeof itemEvent>["item"];

/** Tokens of a `turn.completed`: Codex counts the cached ones inside `input_tokens`, the Hub wants them apart. */
export function toUsage(
  usage: z.infer<typeof usageSchema> | undefined,
  model: string | undefined,
  durationMs: number,
): AgentUsage {
  const input = usage?.input_tokens ?? 0;
  const cached = Math.min(usage?.cached_input_tokens ?? 0, input);
  return {
    ...(model && { model }),
    inputTokens: input - cached,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: cached,
    cacheCreationTokens: usage?.cache_write_input_tokens ?? 0,
    durationMs,
  };
}

/** How a finished non-Neurons item shows in the run log (never its arguments or output). */
function toolOf(item: CodexItem): { tool: string; ok: boolean } | undefined {
  const failed = item.status === "failed" || (item.exit_code !== undefined && item.exit_code !== 0);
  switch (item.type) {
    case "command_execution":
    case "file_change":
    case "web_search":
      return { tool: item.type, ok: !failed };
    case "mcp_tool_call":
      return item.server === MCP_SERVER_NAME
        ? undefined
        : { tool: `${item.server ?? "mcp"}.${item.tool ?? "?"}`, ok: !failed };
    default:
      return undefined;
  }
}

/**
 * Codex as a headless session: one `codex exec --json` per message, the next one resuming the
 * thread of the first (`codex exec resume <thread> -`). The message goes in through stdin; the
 * `turn.completed` event is the explicit end of the turn and carries the tokens. `exec` has no
 * streaming of the model's text (its events are whole items), so the screen gets each message as
 * soon as the model finishes writing it, not token by token.
 */
export class CodexExecRuntime extends CodexRuntimeBase implements StreamingAgentRuntime {
  protected readonly mode = "stream-json";
  /** `exec` reports tokens, not a price. */
  readonly reportsCost = false;

  private context: LaunchContext | undefined;
  private child: ChildProcessWithoutNullStreams | undefined;
  private threadId: string | undefined;

  private readonly writing = new Signal<OutputDelta>();
  private readonly batcher = new OutputBatcher((delta) => this.writing.emit(delta));
  /** The messages of the turn under way (`turnId` ties the pieces of one text together). */
  private turn: TurnState | undefined;

  onOutputDelta(listener: (delta: OutputDelta) => void): Unsubscribe {
    return this.writing.subscribe(listener);
  }

  get processId(): number | undefined {
    return this.child?.pid;
  }

  /** `exec` has no process between turns: booting is making sure the CLI answers, the files are ready. */
  protected launch(context: LaunchContext): Promise<void> {
    this.context = context;
    return Promise.resolve();
  }

  async deliver(message: InboundMessage): Promise<void> {
    if (this.state !== "idle") {
      throw new Error(`O agente "${this.agent.name}" não está ocioso (${this.state}).`);
    }
    this.setState("busy");
    try {
      await this.runTurn(formatInboundMessage(message));
    } catch (error) {
      this.fail(`Não foi possível enviar a mensagem ao Codex: ${errorMessage(error)}`);
      throw error;
    }
  }

  /** The turn under way reports its tokens when `turn.completed` comes: wait for it, up to the flush window. */
  protected override async drain(flushMs: number): Promise<void> {
    await waitUntil(() => this.state !== "busy" && this.state !== "waiting_reply", {
      timeoutMs: flushMs,
      signal: this.lifetime.signal,
      pollMs: DRAIN_POLL_MS,
    });
  }

  protected async terminate(): Promise<void> {
    this.batcher.dispose();
    const child = this.child;
    if (!child?.pid) return;
    child.stdin.end();
    await killProcessTree(child.pid, this.deps.cli.platform);
    await settlesWithin(this.exited(child), 5_000);
    child.stdin.destroy();
  }

  // ---- one turn = one process ----

  private runTurn(prompt: string): Promise<void> {
    const context = this.context;
    const input = this.argsInput;
    if (!context || !input) return Promise.reject(new Error("O Codex ainda não foi iniciado."));

    const { args: prefix } = this.deps.cli.command();
    const args = [
      ...prefix,
      ...buildCodexArgs({ ...input, ...(this.threadId && { resumeThreadId: this.threadId }) }),
    ];
    const child = spawn(context.command, args, {
      cwd: context.cwd,
      env: this.childEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // Its own process group, so the whole tree can be signalled on macOS/Linux.
      detached: this.deps.cli.platform !== "win32",
    });
    this.child = child;

    const turn: TurnState = {
      startedAt: Date.now(),
      turnId: randomUUID(),
      failure: undefined,
      lastError: undefined,
      completed: false,
      stderrTail: "",
      calls: new Map(),
      queue: Promise.resolve(),
    };
    this.turn = turn;

    child.stderr.on("data", (chunk: Buffer) => {
      turn.stderrTail = (turn.stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_CHARS);
    });
    // Writing to a dead process surfaces in the write callback and in `exit`; both end the turn.
    child.stdin.on("error", () => undefined);
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      turn.queue = turn.queue.then(() => this.onLine(turn, line));
    });

    const lineReaderDone = new Promise<void>((resolve) => lines.once("close", resolve));
    const exited = new Promise<number | null>((resolve) => {
      child.once("error", (error) => {
        turn.stderrTail += error.message;
        resolve(null);
      });
      child.once("close", (code) => resolve(code));
    });
    void Promise.all([exited, lineReaderDone]).then(async ([code]) => {
      await turn.queue;
      this.batcher.flush();
      if (this.turn === turn) this.turn = undefined;
      if (this.child === child) this.child = undefined;
      this.finishTurn(turn, code);
    });

    child.stdin.write(prompt, "utf8", (error) => {
      if (error) child.kill();
    });
    child.stdin.end();
    return Promise.resolve();
  }

  private exited(child: ChildProcessWithoutNullStreams): Promise<void> {
    return new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("exit", () => resolve());
    });
  }

  private finishTurn(turn: TurnState, code: number | null): void {
    if (this.lifetime.signal.aborted) return;
    if (turn.failure) {
      this.fail(`O Codex não concluiu o turno do agente "${this.agent.name}": ${turn.failure}`);
      return;
    }
    if (!turn.completed) {
      const detail = (turn.lastError ?? turn.stderrTail).trim();
      this.fail(
        `O Codex encerrou de forma inesperada (código ${code ?? "?"}).${detail ? ` ${detail}` : ""}`,
      );
      return;
    }
    if (this.state === "busy" || this.state === "waiting_reply") this.setState("idle");
  }

  // ---- events ----

  private async onLine(turn: TurnState, line: string): Promise<void> {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return; // not an event (a stray log line)
    }
    try {
      await this.onEvent(turn, event);
    } catch (error) {
      this.deps.logger.error(
        `Falha ao tratar um evento do agente "${this.agent.name}": ${errorMessage(error)}`,
      );
    }
  }

  private async onEvent(turn: TurnState, event: unknown): Promise<void> {
    const started = threadStarted.safeParse(event);
    if (started.success) {
      this.threadId ??= started.data.thread_id;
      return;
    }
    const item = itemEvent.safeParse(event);
    if (item.success) {
      await this.onItem(turn, item.data.type, item.data.item);
      return;
    }
    const completed = turnCompleted.safeParse(event);
    if (completed.success) {
      turn.completed = true;
      this.batcher.flush();
      try {
        await this.reportUsage(
          toUsage(completed.data.usage, this.agent.model, Date.now() - turn.startedAt),
        );
      } catch (error) {
        // The run may already be over; a missing usage record must not take the agent down.
        this.deps.logger.warn(
          `Não foi possível registrar o uso do agente "${this.agent.name}": ${errorMessage(error)}`,
        );
      }
      return;
    }
    const failed = turnFailed.safeParse(event);
    if (failed.success) {
      turn.failure = failed.data.error?.message ?? "sem detalhe";
      return;
    }
    // `error` also carries retries ("Reconnecting...") that end well: only remembered, for the case it does not.
    const error = errorEvent.safeParse(event);
    if (error.success && error.data.message) turn.lastError = error.data.message;
  }

  private async onItem(
    turn: TurnState,
    type: "item.started" | "item.updated" | "item.completed",
    item: CodexItem,
  ): Promise<void> {
    if (type === "item.started") {
      turn.calls.set(item.id, Date.now());
      // The body of a message to another agent shows as soon as the call starts.
      if (item.type === "mcp_tool_call" && item.server === MCP_SERVER_NAME) {
        const field = messageFieldOf(item.tool ?? "");
        const body = field && (item.arguments as Record<string, unknown> | undefined)?.[field];
        if (typeof body === "string") {
          this.batcher.push(`${turn.turnId}:${item.id}`, "message", body);
          this.batcher.flush();
        }
      }
      return;
    }
    if (type !== "item.completed") return;

    if (item.type === "agent_message" && item.text) {
      this.batcher.push(`${turn.turnId}:${item.id}`, "text", item.text);
      this.batcher.flush();
      return;
    }
    const call = toolOf(item);
    if (!call) return;
    const startedAt = turn.calls.get(item.id);
    turn.calls.delete(item.id);
    try {
      await this.communicationReport(call, startedAt);
    } catch {
      // The log of a tool call is a nicety; the turn goes on.
    }
  }

  private communicationReport(
    call: { tool: string; ok: boolean },
    startedAt?: number,
  ): Promise<void> {
    return this.reportToolCall({
      tool: call.tool,
      inputSummary: "[argumentos omitidos]",
      durationMs: startedAt === undefined ? 0 : Math.max(0, Date.now() - startedAt),
      ok: call.ok,
      ...(!call.ok && { errorCode: "CLI_TOOL_FAILED" }),
    });
  }
}

interface TurnState {
  startedAt: number;
  turnId: string;
  failure: string | undefined;
  lastError: string | undefined;
  completed: boolean;
  stderrTail: string;
  /** When each item started, by id, to time the tool calls. */
  calls: Map<string, number>;
  /** Events are handled in order, whatever they await. */
  queue: Promise<void>;
}
