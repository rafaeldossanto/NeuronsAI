import { stat } from "node:fs/promises";
import type { AgentNode } from "@neurons/graph-schema";
import { LocalBridge, type BridgeHooks } from "../bridge/local-bridge.js";
import type { AgentCommunication } from "../contract/agent-communication.js";
import type { AgentRuntime, AgentRuntimeState, InboundMessage } from "../contract/agent-runtime.js";
import type { RuntimeLogger } from "../contract/logger.js";
import { Signal, type Unsubscribe } from "../contract/signal.js";
import { DEFAULT_USAGE_FLUSH_MS, type AgentUsage } from "../contract/usage.js";
import { assertAllowedUserArgs, buildClaudeArgs } from "./claude-args.js";
import type { ClaudeCli } from "./claude-cli.js";
import {
  MCP_TOOL_TIMEOUT_MARGIN_MS,
  SessionFiles,
  type McpServerCommand,
} from "./session-files.js";

/** What the runtimes share and the factory provides once. */
export interface ClaudeRuntimeDeps {
  cli: ClaudeCli;
  mcpServer: McpServerCommand;
  /** The Hub's `ask` timeout: the CLI's MCP tool timeout is derived from it. */
  askTimeoutMs: number;
  logger: RuntimeLogger;
  /** On `stop`, how long a turn still under way may take to end, so its last usage is recorded. */
  usageFlushMs?: number;
}

/** The part of the graph node the Claude runtimes read. */
export interface ClaudeAgentConfig {
  name: string;
  cwd: string;
  args: readonly string[];
  effort: AgentNode["effort"];
  budgetUsd?: number;
}

export type TerminalRuntimeNode = Extract<AgentNode["runtime"], { kind: "terminal" }>;

export function claudeAgentConfig(
  agent: AgentNode,
  runtime: TerminalRuntimeNode,
): ClaudeAgentConfig {
  return {
    name: agent.name,
    cwd: runtime.cwd,
    args: runtime.args,
    effort: agent.effort,
    ...(agent.budgetUsd !== undefined && { budgetUsd: agent.budgetUsd }),
  };
}

/**
 * What both Claude runtimes have in common: the state machine, the local bridge, the temporary
 * session files, the CLI environment and a release path that never leaves a process behind. The
 * subclasses only start the process and decide when a turn is over.
 */
export abstract class ClaudeRuntimeBase implements AgentRuntime {
  protected readonly lifetime = new AbortController();

  private currentState: AgentRuntimeState = "starting";
  private reason: string | undefined;
  private readonly changes = new Signal<AgentRuntimeState>();
  private openAsks = 0;
  private bridge: LocalBridge | undefined;
  private files: SessionFiles | undefined;
  private releasing: Promise<void> | undefined;

  constructor(
    protected readonly agent: ClaudeAgentConfig,
    private readonly communication: AgentCommunication,
    protected readonly deps: ClaudeRuntimeDeps,
  ) {
    assertAllowedUserArgs(agent.name, agent.args);
  }

  get state(): AgentRuntimeState {
    return this.currentState;
  }

  get failureReason(): string | undefined {
    return this.reason;
  }

  /** The folder with this session's temporary files, while the session lives; for diagnostics and tests. */
  get sessionDirectory(): string | undefined {
    return this.files?.directoryPath;
  }

  onStateChange(listener: (state: AgentRuntimeState) => void): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  async start(briefing: string): Promise<void> {
    try {
      await this.prepare(briefing);
      if (this.currentState !== "starting") return; // stopped while booting
      this.setState("idle");
    } catch (error) {
      this.fail(errorMessage(error));
      await this.release();
      throw error;
    }
  }

  abstract deliver(message: InboundMessage): Promise<void>;

  async stop(): Promise<void> {
    // Before the state changes: the turn that is wrapping up still has its usage to report.
    await this.drain(this.deps.usageFlushMs ?? DEFAULT_USAGE_FLUSH_MS);
    this.setState("stopped");
    await this.release();
  }

  // ---- for the subclasses ----

  /** What a subclass does to boot: spawn the CLI and resolve once it can take a message. */
  protected abstract launch(session: LaunchContext): Promise<void>;

  /** Kills the CLI process tree; must be safe to call when nothing was launched. */
  protected abstract terminate(): Promise<void>;

  /**
   * Gives a turn still under way up to `flushMs` to report what it consumed before the CLI is
   * killed. The PTY mode reports no usage, so it has nothing to wait for.
   */
  protected drain(flushMs: number): Promise<void> {
    void flushMs;
    return Promise.resolve();
  }

  /** The hooks the CLI posts to the bridge; the stream-json mode has none. */
  protected hooks(): BridgeHooks | undefined {
    return undefined;
  }

  protected abstract readonly mode: "pty" | "stream-json";

  abstract readonly reportsCost: boolean;

  protected get closed(): boolean {
    return this.currentState === "stopped" || this.currentState === "failed";
  }

  protected setState(state: AgentRuntimeState): void {
    if (this.closed || this.currentState === state) return;
    this.currentState = state;
    this.changes.emit(state);
  }

  protected fail(reason: string): void {
    if (this.closed) return;
    this.reason = reason;
    this.setState("failed");
    void this.release();
  }

  protected reportUsage(usage: AgentUsage): Promise<void> {
    return this.communication.reportUsage(usage);
  }

  // ---- boot ----

  private async prepare(briefing: string): Promise<void> {
    const { cli } = this.deps;
    cli.command(); // fails early, with the message for the user, when the CLI is not installed
    await this.assertWorkingDirectory();
    await cli.ensureLoggedIn();

    const hooks = this.hooks();
    const bridge = new LocalBridge({
      communication: this.trackedCommunication(),
      logger: this.deps.logger,
      ...(hooks && { hooks }),
    });
    this.bridge = bridge;
    await bridge.start();

    this.files = await SessionFiles.create({
      bridgeUrl: bridge.url,
      bridgeToken: bridge.token,
      mcpServer: this.deps.mcpServer,
      askTimeoutMs: this.deps.askTimeoutMs,
      briefing,
      withHooks: hooks !== undefined,
    });

    const { command, args: prefix } = cli.command();
    const args = [
      ...prefix,
      ...buildClaudeArgs({
        mode: this.mode,
        mcpConfigFile: this.files.mcpConfigFile,
        briefingFile: this.files.briefingFile,
        ...(this.files.settingsFile && { settingsFile: this.files.settingsFile }),
        ...(await this.supportedEffort()),
        ...(this.agent.budgetUsd !== undefined && { maxBudgetUsd: this.agent.budgetUsd }),
        userArgs: this.agent.args,
      }),
    ];
    const env = cli.env({
      // Hard per-call limit of every MCP tool: must outlive the Hub's `ask` timeout.
      MCP_TOOL_TIMEOUT: String(this.deps.askTimeoutMs + MCP_TOOL_TIMEOUT_MARGIN_MS),
    });
    await this.launch({ command, args, env, cwd: this.agent.cwd });
  }

  private async assertWorkingDirectory(): Promise<void> {
    const found = await stat(this.agent.cwd).catch(() => undefined);
    if (!found?.isDirectory()) {
      throw new Error(
        `A pasta de trabalho do agente "${this.agent.name}" não existe: ${this.agent.cwd}`,
      );
    }
  }

  private async supportedEffort(): Promise<{ effort: string } | Record<string, never>> {
    if (await this.deps.cli.supportsFlag("--effort")) return { effort: this.agent.effort };
    this.deps.logger.warn(
      `O Claude Code instalado não tem a opção --effort: o esforço "${this.agent.effort}" do agente "${this.agent.name}" será ignorado.`,
    );
    return {};
  }

  // ---- asks ----

  /** The communication handed to the bridge: the same tools, but an open `ask` shows as `waiting_reply`. */
  private trackedCommunication(): AgentCommunication {
    const inner = this.communication;
    return {
      sendMessage: (to, text) => inner.sendMessage(to, text),
      reply: (messageId, text) => inner.reply(messageId, text),
      listPeers: () => inner.listPeers(),
      finish: (result) => inner.finish(result),
      reportUsage: (usage) => inner.reportUsage(usage),
      reportToolCall: (report) => inner.reportToolCall(report),
      ask: async (to, question, options) => {
        this.askOpened();
        try {
          return await inner.ask(to, question, options);
        } finally {
          this.askClosed();
        }
      },
    };
  }

  private askOpened(): void {
    this.openAsks++;
    if (this.currentState === "busy") this.setState("waiting_reply");
  }

  private askClosed(): void {
    this.openAsks--;
    if (this.openAsks === 0 && this.currentState === "waiting_reply") this.setState("busy");
  }

  // ---- teardown ----

  /** Idempotent: kills the CLI, closes the bridge and deletes the temporary files, in that order. */
  private release(): Promise<void> {
    this.releasing ??= this.tearDown();
    return this.releasing;
  }

  private async tearDown(): Promise<void> {
    this.lifetime.abort();
    const attempt = async (step: () => Promise<void> | undefined) => {
      try {
        await step();
      } catch (error) {
        this.deps.logger.error(
          `Falha ao encerrar o agente "${this.agent.name}": ${errorMessage(error)}`,
        );
      }
    };
    await attempt(() => this.terminate());
    await attempt(() => this.bridge?.stop());
    await attempt(() => this.files?.dispose());
  }
}

/** What a subclass needs to spawn the CLI. */
export interface LaunchContext {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
