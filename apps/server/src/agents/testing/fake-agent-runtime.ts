import type {
  AgentUsage,
  AgentCommunication,
  AgentRuntime,
  AgentRuntimeFactory,
  AgentRuntimeState,
  InboundMessage,
  TerminalAgentRuntime,
  TerminalSize,
  ToolCallReport,
} from "@neurons/agent-runtimes";
import type { AgentNode, AgentPeers } from "@neurons/graph-schema";
import { Signal, type Unsubscribe } from "../../shared/signal.js";

const EMPTY_USAGE: AgentUsage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

/** What a scripted agent can do while it handles one message. */
export interface FakeTurn {
  readonly message: InboundMessage;
  /** Keeps the agent busy for a while. */
  work(ms: number): Promise<void>;
  send(to: string, text: string): Promise<{ messageId: string }>;
  /** The agent is `waiting_reply` until the answer (or the timeout) arrives. */
  ask(to: string, question: string, options?: { timeoutMs?: number }): Promise<string>;
  /** Answers the message being handled. */
  reply(text: string): Promise<{ messageId: string }>;
  finish(result: string): Promise<void>;
  peers(): AgentPeers | Promise<AgentPeers>;
  /** Reports what the turn consumed, as stream-json does at the end of a turn. */
  usage(usage: { costUsd: number } & Partial<Omit<AgentUsage, "costUsd">>): Promise<void>;
  /** Reports a turn whose price is unknown. */
  usageWithoutCost(): Promise<void>;
  /** Reports a call to a tool of its own (not one of the Hub's). */
  toolCall(report: Partial<ToolCallReport> & { tool: string }): Promise<void>;
}

export type FakeScript = (turn: FakeTurn) => Promise<void> | void;

export interface FakeRuntimeOptions {
  /** Never confirms receiving a message (as if the process died while delivering). */
  neverAck?: boolean;
  /** Fails to start with this message. */
  failOnStart?: string;
  /** Never finishes booting by itself (a CLI at a dialog nobody answers); `stop` ends the boot. */
  hangOnStart?: boolean;
  /** Whether the runtime reports what its turns cost (like stream-json); default true. */
  reportsCost?: boolean;
  /** Reports a turn with this cost while stopping, like a closing turn whose `result` arrives late. */
  usageOnStop?: number;
  /** Behaves as a terminal runtime: it has a screen to watch and takes typed input. */
  terminal?: boolean;
}

/** A scriptable {@link AgentRuntime} for tests: handles each message by running its script. */
export class FakeAgentRuntime implements AgentRuntime {
  readonly received: InboundMessage[] = [];
  briefing: string | undefined;
  stopCount = 0;
  failureReason: string | undefined;
  readonly reportsCost: boolean;

  private currentState: AgentRuntimeState = "starting";
  private readonly changes = new Signal<AgentRuntimeState>();
  private endBoot: (() => void) | undefined;

  constructor(
    readonly name: string,
    private readonly script: FakeScript,
    private readonly communication: AgentCommunication,
    private readonly options: FakeRuntimeOptions = {},
  ) {
    this.reportsCost = options.reportsCost ?? true;
  }

  get state(): AgentRuntimeState {
    return this.currentState;
  }

  onStateChange(listener: (state: AgentRuntimeState) => void): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  async start(briefing: string): Promise<void> {
    this.briefing = briefing;
    await Promise.resolve();
    if (this.options.hangOnStart) {
      await new Promise<void>((resolve) => (this.endBoot = resolve));
      return;
    }
    if (this.options.failOnStart) {
      this.fail(this.options.failOnStart);
      throw new Error(this.options.failOnStart);
    }
    this.setState("idle");
  }

  async deliver(message: InboundMessage): Promise<void> {
    if (this.options.neverAck) return new Promise<void>(() => undefined);
    this.received.push(message);
    this.setState("busy");
    void this.runTurn(message);
    await Promise.resolve();
  }

  async stop(): Promise<void> {
    this.stopCount++;
    this.endBoot?.();
    if (this.options.usageOnStop !== undefined) {
      await this.communication.reportUsage({ ...EMPTY_USAGE, costUsd: this.options.usageOnStop });
    }
    this.setState("stopped");
  }

  private async runTurn(message: InboundMessage): Promise<void> {
    try {
      await this.script(this.turnFor(message));
      if (this.currentState === "busy") this.setState("idle");
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private turnFor(message: InboundMessage): FakeTurn {
    const communication = this.communication;
    return {
      message,
      work: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      send: (to, text) => communication.sendMessage(to, text),
      ask: async (to, question, options) => {
        this.setState("waiting_reply");
        try {
          return await communication.ask(to, question, options);
        } finally {
          if (this.currentState === "waiting_reply") this.setState("busy");
        }
      },
      reply: (text) => communication.reply(message.id, text),
      finish: (result) => communication.finish(result),
      peers: () => communication.listPeers(),
      usage: (usage) => communication.reportUsage({ ...EMPTY_USAGE, ...usage }),
      usageWithoutCost: () => communication.reportUsage({ ...EMPTY_USAGE }),
      toolCall: (report) =>
        communication.reportToolCall({ inputSummary: "{}", durationMs: 5, ok: true, ...report }),
    };
  }

  private fail(reason: string): void {
    this.failureReason = reason;
    this.setState("failed");
  }

  private setState(state: AgentRuntimeState): void {
    if (this.currentState === "stopped" || this.currentState === state) return;
    this.currentState = state;
    this.changes.emit(state);
  }
}

/** A scriptable runtime that also has a terminal: what is typed into it is kept in {@link typed}. */
export class FakeTerminalRuntime extends FakeAgentRuntime implements TerminalAgentRuntime {
  /** Everything typed into the terminal, in order. */
  readonly typed: string[] = [];
  /** Every size it was asked to take, in order (the same size twice is not a change). */
  readonly resized: TerminalSize[] = [];
  private readonly output = new Signal<string>();
  private readonly resizes = new Signal<TerminalSize>();
  private screen = "";
  private currentSize: TerminalSize = { cols: 120, rows: 40 };

  /** The terminal prints something. */
  print(chunk: string): void {
    this.screen += chunk;
    this.output.emit(chunk);
  }

  onOutput(listener: (chunk: string) => void): Unsubscribe {
    return this.output.subscribe(listener);
  }

  outputSnapshot(): string {
    return this.screen;
  }

  writeInput(data: string): void {
    this.typed.push(data);
  }

  get size(): TerminalSize {
    return { ...this.currentSize };
  }

  onResize(listener: (size: TerminalSize) => void): Unsubscribe {
    return this.resizes.subscribe(listener);
  }

  resize(cols: number, rows: number): void {
    if (cols === this.currentSize.cols && rows === this.currentSize.rows) return;
    this.currentSize = { cols, rows };
    this.resized.push({ cols, rows });
    this.screen = ""; // the replay restarts at the resize, as in the real runtimes
    this.resizes.emit({ cols, rows });
  }
}

/** Builds {@link FakeAgentRuntime}s from per-agent scripts (agents without one just go idle again). */
export class FakeAgentRuntimeFactory implements AgentRuntimeFactory {
  /** Every runtime created, in order. */
  readonly created: FakeAgentRuntime[] = [];

  constructor(
    private readonly scripts: Record<string, FakeScript> = {},
    private readonly options: Record<string, FakeRuntimeOptions> = {},
  ) {}

  setScript(agentName: string, script: FakeScript): void {
    this.scripts[agentName] = script;
  }

  setOptions(agentName: string, options: FakeRuntimeOptions): void {
    this.options[agentName] = options;
  }

  create(agent: AgentNode, communication: AgentCommunication): FakeAgentRuntime {
    const options = this.options[agent.name];
    const Runtime = options?.terminal ? FakeTerminalRuntime : FakeAgentRuntime;
    const runtime = new Runtime(
      agent.name,
      this.scripts[agent.name] ?? (() => undefined),
      communication,
      options,
    );
    this.created.push(runtime);
    return runtime;
  }

  /** The latest runtime created for the agent. */
  runtimeOf(agentName: string): FakeAgentRuntime | undefined {
    return this.created.findLast((runtime) => runtime.name === agentName);
  }
}
