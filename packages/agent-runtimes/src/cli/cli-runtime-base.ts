import { stat } from "node:fs/promises";
import type { AgentNode } from "@neurons/graph-schema";
import { LocalBridge, type BridgeHooks } from "../bridge/local-bridge.js";
import type { AgentCommunication } from "../contract/agent-communication.js";
import type { AgentRuntime, AgentRuntimeState, InboundMessage } from "../contract/agent-runtime.js";
import type { RuntimeLogger } from "../contract/logger.js";
import { Signal, type Unsubscribe } from "../contract/signal.js";
import type { ToolCallReport } from "../contract/tool-call.js";
import { DEFAULT_USAGE_FLUSH_MS, type AgentUsage } from "../contract/usage.js";
import type { McpServerCommand } from "../claude/session-files.js";

/** What the runtimes need from "the CLI of an agent" (Claude Code, Codex): where it is and how it runs. */
export interface AgentCliHandle {
  readonly platform: NodeJS.Platform;
  /** @throws when the CLI is not installed, with a message for the user. */
  command(): { command: string; args: string[] };
}

/** What every CLI runtime shares and the factory provides once. */
export interface CliRuntimeDeps {
  apiKey?: string;
  cli: AgentCliHandle;
  mcpServer: McpServerCommand;
  /** The Hub's `ask` timeout: the CLI's MCP tool timeout is derived from it. */
  askTimeoutMs: number;
  logger: RuntimeLogger;
  /** On `stop`, how long a turn still under way may take to end, so its last usage is recorded. */
  usageFlushMs?: number;
}

/** The part of the graph node every CLI runtime reads. */
export interface CliAgentConfig {
  name: string;
  cwd: string;
  args: readonly string[];
  effort: AgentNode["effort"];
  model?: string;
  budgetUsd?: number;
}

export type TerminalRuntimeNode = Extract<AgentNode["runtime"], { kind: "terminal" }>;

/** A scratch folder of the session (temporary files with a token): removed when the agent ends. */
export interface SessionResource {
  readonly directoryPath: string;
  dispose(): Promise<void>;
}

/** What a subclass hands back once it has made its session files: the CLI's arguments and environment. */
export interface SessionInvocation {
  /** After the arguments that start the CLI itself (a script path, for a Node shim). */
  args: string[];
  env: Record<string, string>;
}

/** What a subclass needs to spawn the CLI. */
export interface LaunchContext {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

/**
 * What every CLI runtime has in common: the state machine, the local bridge, the temporary session
 * files, and a release path that never leaves a process behind. The subclasses know their CLI (its
 * login, its arguments, its files) and start the process; the leaves decide when a turn is over.
 */
export abstract class CliRuntimeBase implements AgentRuntime {
  protected readonly lifetime = new AbortController();

  private currentState: AgentRuntimeState = "starting";
  private reason: string | undefined;
  private readonly changes = new Signal<AgentRuntimeState>();
  private openAsks = 0;
  private bridge: LocalBridge | undefined;
  private resource: SessionResource | undefined;
  private releasing: Promise<void> | undefined;
  /** The boot under way, never rejecting: what `stop` waits for after cutting it short. */
  private booting: Promise<void> | undefined;
  private stopRequested = false;

  constructor(
    protected readonly agent: CliAgentConfig,
    private readonly communication: AgentCommunication,
    protected readonly deps: CliRuntimeDeps,
  ) {}

  get state(): AgentRuntimeState {
    return this.currentState;
  }

  get failureReason(): string | undefined {
    return this.reason;
  }

  /** The folder with this session's temporary files, while the session lives; for diagnostics and tests. */
  get sessionDirectory(): string | undefined {
    return this.resource?.directoryPath;
  }

  onStateChange(listener: (state: AgentRuntimeState) => void): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  start(briefing: string): Promise<void> {
    // Stopped before it even began (the stop does not wait for a start nobody called yet).
    if (this.stopRequested || this.closed) return Promise.resolve();
    const boot = this.boot(briefing);
    this.booting = boot.then(
      () => undefined,
      () => undefined,
    );
    return boot;
  }

  private async boot(briefing: string): Promise<void> {
    try {
      await this.prepare(briefing);
      if (this.currentState !== "starting") return; // stopped while booting
      this.setState("idle");
    } catch (error) {
      if (this.stopRequested) {
        // Asked to stop while booting: the wait for the CLI was cut short, which is no failure.
        await this.release();
        return;
      }
      this.fail(errorMessage(error));
      await this.release();
      throw error;
    }
  }

  abstract deliver(message: InboundMessage): Promise<void>;

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.currentState === "starting" && this.booting) {
      // Still booting: the wait for the CLI (a minute, at a dialog nobody answers) ends as soon as
      // the lifetime is aborted, and the boot tears everything it created down on its way out.
      this.lifetime.abort();
      await this.booting;
    }
    // Before the state changes: the turn that is wrapping up still has its usage to report.
    await this.drain(this.deps.usageFlushMs ?? DEFAULT_USAGE_FLUSH_MS);
    this.setState("stopped");
    await this.release();
  }

  // ---- for the subclasses ----

  /** Fails (with a message for the user) when this CLI has nobody logged in. Skipped with an API key. */
  protected abstract assertLoggedIn(): Promise<void>;

  /**
   * Makes the session files (call {@link adopt} right away, so a failure later still cleans up) and
   * builds the CLI's arguments and environment. `bridge` is already listening.
   */
  protected abstract openSession(input: {
    briefing: string;
    bridge: LocalBridge;
  }): Promise<SessionInvocation>;

  /** What a subclass does to boot: spawn the CLI and resolve once it can take a message. */
  protected abstract launch(session: LaunchContext): Promise<void>;

  /** Kills the CLI process tree; must be safe to call when nothing was launched. */
  protected abstract terminate(): Promise<void>;

  /** Hands the session's scratch folder over: it is removed on release, whatever happens next. */
  protected adopt(resource: SessionResource): void {
    this.resource = resource;
  }

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

  protected reportToolCall(report: ToolCallReport): Promise<void> {
    return this.communication.reportToolCall(report);
  }

  // ---- boot ----

  private async prepare(briefing: string): Promise<void> {
    const { cli } = this.deps;
    cli.command(); // fails early, with the message for the user, when the CLI is not installed
    await this.assertWorkingDirectory();
    if (!this.deps.apiKey) await this.assertLoggedIn();

    const hooks = this.hooks();
    const bridge = new LocalBridge({
      communication: this.trackedCommunication(),
      logger: this.deps.logger,
      ...(hooks && { hooks }),
    });
    this.bridge = bridge;
    await bridge.start();

    const { args, env } = await this.openSession({ briefing, bridge });
    const { command, args: prefix } = cli.command();
    // Stopped while the files and the bridge were being made: nothing to spawn, `boot` cleans up.
    if (this.lifetime.signal.aborted) throw new Error("O agente foi encerrado antes de subir.");
    await this.launch({ command, args: [...prefix, ...args], env, cwd: this.agent.cwd });
  }

  private async assertWorkingDirectory(): Promise<void> {
    const found = await stat(this.agent.cwd).catch(() => undefined);
    if (!found?.isDirectory()) {
      throw new Error(
        `A pasta de trabalho do agente "${this.agent.name}" não existe: ${this.agent.cwd}`,
      );
    }
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
      listTools: () => inner.listTools?.() ?? Promise.resolve([]),
      useTool: (nodeId, name, input) =>
        inner.useTool
          ? inner.useTool(nodeId, name, input)
          : Promise.reject(new Error("Ferramentas indisponíveis.")),
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
    await attempt(() => this.resource?.dispose());
  }
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
