import { randomUUID } from "node:crypto";
import type {
  AgentCommunication,
  AgentRuntime,
  AgentRuntimeState,
  InboundMessage,
  TerminalAgentRuntime,
} from "@neurons/agent-runtimes";
import type { AgentNode } from "@neurons/graph-schema";
import {
  PROTOCOL_VERSION,
  type AgentState,
  type Call,
  type RequestFrame,
  type StartSettings,
} from "@neurons/runner-protocol";
import { settlesWithin } from "../shared/settles-within.js";
import { Signal, type Unsubscribe } from "../shared/signal.js";

/** The part of a runner connection that a {@link RemoteAgentRuntime} uses. */
export interface RunnerEndpoint {
  readonly name: string;
  bind(runtime: RemoteAgentRuntime): void;
  unbind(instanceId: string): void;
  /** Sends the request and resolves when the runner answers it (repeating it after a reconnection). */
  request(build: (requestId: string) => RequestFrame, instanceId: string): Promise<void>;
  sendInput(instanceId: string, data: string): void;
}

/** Where the runtimes find the runner that will host them. */
export interface RunnerPool {
  /** @throws NoRunnerAvailableError when none shows up in time. */
  acquire(): Promise<RunnerEndpoint>;
}

export interface RemoteRuntimeOptions {
  settings: StartSettings;
  /** How long `stop` waits for the runner's answer before giving up on it. */
  stopWaitMs: number;
}

export type CallOutcome = { ok: true; result: unknown } | { ok: false; message: string };

/**
 * An agent whose session lives in a runner (an embedded one or a remote process). To the Hub it is
 * an ordinary {@link AgentRuntime}: `start`, `deliver` and `stop` become requests to the runner,
 * the state it reports is mirrored here, and what the agent does through the Hub's tools comes back
 * as calls that run on this agent's {@link AgentCommunication}.
 */
export class RemoteAgentRuntime implements AgentRuntime {
  readonly instanceId = randomUUID();
  readonly reportsCost: boolean;

  private currentState: AgentRuntimeState = "starting";
  private reason: string | undefined;
  private readonly changes = new Signal<AgentRuntimeState>();
  protected endpoint: RunnerEndpoint | undefined;
  private stopping: Promise<void> | undefined;

  constructor(
    protected readonly agent: AgentNode,
    private readonly communication: AgentCommunication,
    private readonly pool: RunnerPool,
    private readonly options: RemoteRuntimeOptions,
  ) {
    // The runner reports the cost of stream-json turns only (a PTY has no usage output).
    this.reportsCost = agent.runtime.kind === "terminal" && agent.runtime.mode === "stream-json";
  }

  get state(): AgentRuntimeState {
    return this.currentState;
  }

  get failureReason(): string | undefined {
    return this.reason;
  }

  onStateChange(listener: (state: AgentRuntimeState) => void): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  async start(briefing: string): Promise<void> {
    try {
      const endpoint = await this.pool.acquire();
      if (this.closed) return; // stopped while waiting for a runner
      this.endpoint = endpoint;
      endpoint.bind(this);
      await endpoint.request(
        (requestId) => ({
          v: PROTOCOL_VERSION,
          type: "agent.start",
          requestId,
          instanceId: this.instanceId,
          agent: this.agent,
          briefing,
          settings: this.options.settings,
        }),
        this.instanceId,
      );
      // The runner reports `idle` before it answers; this only covers a report lost on the way.
      if (this.currentState === "starting") this.setState("idle");
    } catch (error) {
      this.fail(errorMessage(error));
      throw error;
    }
  }

  async deliver(message: InboundMessage): Promise<void> {
    const endpoint = this.endpoint;
    if (!endpoint || this.closed) {
      throw new Error(`O agente "${this.agent.name}" não está em execução (${this.currentState}).`);
    }
    await endpoint.request(
      (requestId) => ({
        v: PROTOCOL_VERSION,
        type: "agent.deliver",
        requestId,
        instanceId: this.instanceId,
        message,
      }),
      this.instanceId,
    );
  }

  stop(): Promise<void> {
    this.stopping ??= this.stopRemote();
    return this.stopping;
  }

  // ---- what the runner connection feeds in ----

  /** The runner reported this agent's state (live, or in the snapshot of a new connection). */
  applyRemoteState(state: AgentState, failureReason?: string): void {
    if (this.closed) return;
    if (failureReason) this.reason = failureReason;
    this.setState(state);
  }

  /** The runner lost the agent, or the connection did not come back in time. */
  connectionLost(reason: string): void {
    this.fail(reason);
  }

  /** Raw terminal output; only terminal runtimes keep it. */
  applyOutput(data: string): void {
    void data;
  }

  /** Runs an agent's call on the Hub's side. */
  async execute(call: Call): Promise<unknown> {
    const hub = this.communication;
    switch (call.method) {
      case "send_message":
        return hub.sendMessage(call.to, call.text);
      case "ask":
        return hub.ask(call.to, call.question, {
          ...(call.timeoutMs !== undefined && { timeoutMs: call.timeoutMs }),
        });
      case "reply":
        return hub.reply(call.messageId, call.text);
      case "list_peers":
        return hub.listPeers();
      case "finish":
        await hub.finish(call.result);
        return null;
      case "report_usage":
        await hub.reportUsage(call.usage);
        return null;
    }
  }

  // ---- internals ----

  private async stopRemote(): Promise<void> {
    const endpoint = this.endpoint;
    if (endpoint) {
      // Includes the closing turn's usage report, which reaches the Hub before the runner answers.
      await settlesWithin(
        endpoint.request(
          (requestId) => ({
            v: PROTOCOL_VERSION,
            type: "agent.stop",
            requestId,
            instanceId: this.instanceId,
          }),
          this.instanceId,
        ),
        this.options.stopWaitMs,
      );
      endpoint.unbind(this.instanceId);
    }
    this.setState("stopped");
  }

  protected get closed(): boolean {
    return this.currentState === "stopped" || this.currentState === "failed";
  }

  protected fail(reason: string): void {
    if (this.closed) return;
    this.reason = reason;
    this.setState("failed");
  }

  protected setState(state: AgentRuntimeState): void {
    if (this.currentState === "stopped" || this.currentState === state) return;
    this.currentState = state;
    this.changes.emit(state);
  }
}

/** Bytes of terminal output kept for whoever opens the terminal after the session started. */
const SNAPSHOT_CHARS = 200_000;

/** A remote agent that has a terminal a person can watch and type into. */
export class RemoteTerminalRuntime extends RemoteAgentRuntime implements TerminalAgentRuntime {
  private readonly outputs = new Signal<string>();
  private tail = "";

  override applyOutput(data: string): void {
    this.tail = (this.tail + data).slice(-SNAPSHOT_CHARS);
    this.outputs.emit(data);
  }

  onOutput(listener: (chunk: string) => void): Unsubscribe {
    return this.outputs.subscribe(listener);
  }

  outputSnapshot(): string {
    return this.tail;
  }

  writeInput(data: string): void {
    this.endpoint?.sendInput(this.instanceId, data);
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
