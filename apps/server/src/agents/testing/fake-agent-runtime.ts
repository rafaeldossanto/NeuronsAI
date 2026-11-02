import type {
  AgentCommunication,
  AgentRuntime,
  AgentRuntimeFactory,
  AgentRuntimeState,
  InboundMessage,
} from "@neurons/agent-runtimes";
import type { AgentNode, AgentPeers } from "@neurons/graph-schema";
import { Signal, type Unsubscribe } from "../../shared/signal.js";

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
  peers(): AgentPeers;
}

export type FakeScript = (turn: FakeTurn) => Promise<void> | void;

export interface FakeRuntimeOptions {
  /** Never confirms receiving a message (as if the process died while delivering). */
  neverAck?: boolean;
  /** Fails to start with this message. */
  failOnStart?: string;
}

/** A scriptable {@link AgentRuntime} for tests: handles each message by running its script. */
export class FakeAgentRuntime implements AgentRuntime {
  readonly received: InboundMessage[] = [];
  briefing: string | undefined;
  stopCount = 0;
  failureReason: string | undefined;

  private currentState: AgentRuntimeState = "starting";
  private readonly changes = new Signal<AgentRuntimeState>();

  constructor(
    readonly name: string,
    private readonly script: FakeScript,
    private readonly communication: AgentCommunication,
    private readonly options: FakeRuntimeOptions = {},
  ) {}

  get state(): AgentRuntimeState {
    return this.currentState;
  }

  onStateChange(listener: (state: AgentRuntimeState) => void): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  async start(briefing: string): Promise<void> {
    this.briefing = briefing;
    await Promise.resolve();
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

  stop(): Promise<void> {
    this.stopCount++;
    this.setState("stopped");
    return Promise.resolve();
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
    const runtime = new FakeAgentRuntime(
      agent.name,
      this.scripts[agent.name] ?? (() => undefined),
      communication,
      this.options[agent.name],
    );
    this.created.push(runtime);
    return runtime;
  }

  /** The latest runtime created for the agent. */
  runtimeOf(agentName: string): FakeAgentRuntime | undefined {
    return this.created.findLast((runtime) => runtime.name === agentName);
  }
}
