import type { Unsubscribe } from "./signal.js";

export const AGENT_RUNTIME_STATES = [
  "starting",
  "busy",
  "idle",
  "waiting_reply",
  "stopped",
  "failed",
] as const;
export type AgentRuntimeState = (typeof AGENT_RUNTIME_STATES)[number];

export type InboundMessageKind = "message" | "ask" | "reply";

/** What a runtime receives when the Hub hands it a message from its inbox. */
export interface InboundMessage {
  id: string;
  /** Agent name, or one of the external addresses (`@human`, `@trigger`). */
  from: string;
  kind: InboundMessageKind;
  body: string;
  /** Id of the message this one answers (only for `reply`). */
  replyTo: string | null;
}

/**
 * One live agent session of a run. Implementations (API, terminal) live behind this port so the
 * Hub and the Supervisor never know how the agent actually runs.
 *
 * The runtime owns its `state`:
 *  - `starting` until `start` finishes, then `idle`;
 *  - `busy` while it works on a delivered message;
 *  - `waiting_reply` while an `ask` it issued through its `AgentCommunication` is open;
 *  - `idle` when it can take the next message;
 *  - `stopped` after `stop`, `failed` when it cannot continue.
 */
export interface AgentRuntime {
  readonly state: AgentRuntimeState;
  /**
   * Whether the runtime tells the Hub what its turns cost (`reportUsage` with a `costUsd`). A
   * budget cannot be enforced on a runtime that does not: the guards say so instead of counting 0.
   */
  readonly reportsCost: boolean;
  /** Human-readable cause, when `state` is `failed`. */
  readonly failureReason?: string;

  /** Subscribes to state changes; the listener is called after `state` already holds the new value. */
  onStateChange(listener: (state: AgentRuntimeState) => void): Unsubscribe;

  /** Boots the session with its briefing. Resolves once the runtime is ready (state `idle`). */
  start(briefing: string): Promise<void>;

  /**
   * Hands one message to the agent. Resolves when the runtime has confirmed receiving it; by then
   * `state` has left `idle` (the Hub treats the resolution as the acknowledgement).
   */
  deliver(message: InboundMessage): Promise<void>;

  stop(): Promise<void>;
}
