import { fileURLToPath } from "node:url";
import type { AgentNode, AgentPeers } from "@neurons/graph-schema";
import type { AgentCommunication } from "../contract/agent-communication.js";
import type { AgentRuntime, AgentRuntimeState } from "../contract/agent-runtime.js";
import type { RuntimeLogger } from "../contract/logger.js";
import type { ToolCallReport } from "../contract/tool-call.js";
import type { AgentUsage } from "../contract/usage.js";
import { ClaudeCli, type ClaudeCliOptions } from "../claude/claude-cli.js";
import type { ClaudeRuntimeDeps } from "../claude/claude-runtime-base.js";
import { readHostEnvironment, type HostEnvironment } from "../platform/host-environment.js";
import { neuronsServerEntry } from "@neurons/mcp-neurons";

const FAKE_CLAUDE = fileURLToPath(new URL("../../test-fixtures/fake-claude.mjs", import.meta.url));

/** The fake CLI as a {@link ClaudeCliOptions.command}: Node running the script, with fake flags. */
export const fakeClaudeCommand = (...fakeFlags: string[]) => ({
  command: process.execPath,
  args: [FAKE_CLAUDE, ...fakeFlags],
});

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const peers: AgentPeers = {
  canMessage: [{ id: "revisor", name: "Revisor", role: "revisa" }],
  canBeMessagedBy: [{ id: "revisor", name: "Revisor", role: "revisa" }],
};

/** A communication that records the calls; an `ask` stays open until the test answers it. */
export class RecordingCommunication implements AgentCommunication {
  readonly sent: { to: string; text: string }[] = [];
  readonly asked: { to: string; question: string }[] = [];
  readonly replies: { messageId: string; text: string }[] = [];
  readonly finished: string[] = [];
  readonly usage: AgentUsage[] = [];
  readonly toolCalls: ToolCallReport[] = [];
  private readonly pendingAsks: Deferred<string>[] = [];

  sendMessage(to: string, text: string): Promise<{ messageId: string }> {
    this.sent.push({ to, text });
    return Promise.resolve({ messageId: `sent-${this.sent.length}` });
  }

  ask(to: string, question: string): Promise<string> {
    this.asked.push({ to, question });
    const pending = deferred<string>();
    this.pendingAsks.push(pending);
    return pending.promise;
  }

  reply(messageId: string, text: string): Promise<{ messageId: string }> {
    this.replies.push({ messageId, text });
    return Promise.resolve({ messageId: `reply-${this.replies.length}` });
  }

  listPeers(): AgentPeers {
    return peers;
  }

  finish(result: string): Promise<void> {
    this.finished.push(result);
    return Promise.resolve();
  }

  reportUsage(usage: AgentUsage): Promise<void> {
    this.usage.push(usage);
    return Promise.resolve();
  }

  reportToolCall(report: ToolCallReport): Promise<void> {
    this.toolCalls.push(report);
    return Promise.resolve();
  }

  /** Answers the oldest open ask. */
  answerAsk(answer: string): void {
    this.pendingAsks.shift()?.resolve(answer);
  }
}

export class RecordingLogger implements RuntimeLogger {
  readonly warnings: string[] = [];
  readonly errors: string[] = [];
  warn(message: string): void {
    this.warnings.push(message);
  }
  error(message: string): void {
    this.errors.push(message);
  }
}

export interface TestDepsOptions {
  fakeFlags?: string[];
  host?: HostEnvironment;
  askTimeoutMs?: number;
  usageFlushMs?: number;
  cli?: ClaudeCliOptions;
}

/** Runtime dependencies wired to the fake CLI and the real `neurons` MCP server. */
export function testDeps(
  options: TestDepsOptions = {},
): ClaudeRuntimeDeps & { logger: RecordingLogger } {
  const logger = new RecordingLogger();
  return {
    cli: new ClaudeCli({
      command: fakeClaudeCommand(...(options.fakeFlags ?? [])),
      host: options.host ?? readHostEnvironment(),
      ...options.cli,
    }),
    mcpServer: { command: process.execPath, args: [neuronsServerEntry()] },
    askTimeoutMs: options.askTimeoutMs ?? 5_000,
    ...(options.usageFlushMs !== undefined && { usageFlushMs: options.usageFlushMs }),
    logger,
  };
}

export function terminalAgent(
  overrides: {
    name?: string;
    mode?: "pty" | "stream-json";
    cwd?: string;
    args?: string[];
    cli?: "claude" | "codex";
  } = {},
): AgentNode {
  return {
    id: overrides.name ?? "agent",
    type: "agent",
    position: { x: 0, y: 0 },
    name: overrides.name ?? "Pesquisador",
    role: "pesquisa",
    instructions: "pesquise",
    effort: "low",
    runtime: {
      kind: "terminal",
      cli: overrides.cli ?? "claude",
      mode: overrides.mode ?? "pty",
      args: overrides.args ?? [],
      cwd: overrides.cwd ?? process.cwd(),
    },
  };
}

/** Resolves when the runtime reaches the state (immediately if it is already there). */
export function untilState(
  runtime: AgentRuntime,
  state: AgentRuntimeState,
  timeoutMs = 60_000,
): Promise<void> {
  if (runtime.state === state) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `Timeout waiting for "${state}"; the runtime is "${runtime.state}" (${runtime.failureReason ?? "no failure reason"}).`,
          ),
        ),
      timeoutMs,
    );
    const stop = runtime.onStateChange((current) => {
      if (current !== state) return;
      clearTimeout(timer);
      stop();
      resolve();
    });
  });
}

/** Polls until the condition holds. */
export async function eventually(condition: () => boolean, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timeout waiting for the condition.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
