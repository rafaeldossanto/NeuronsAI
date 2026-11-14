/** Public types of the live run data. The contract is documented in `README.md`. */

export type AgentLiveStatus =
  "starting" | "busy" | "idle" | "waiting_reply" | "failed" | "finished";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "closed";

/** Same values as the REST `status` of a run. */
export type RunLiveStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export type LiveMessageKind = "message" | "ask" | "reply";

/** One message crossing an arrow; T14b animates the latest ones. `from`/`to` are agent names or `@human`/`@trigger`. */
export interface LivePulse {
  from: string;
  to: string;
  kind: LiveMessageKind;
  seq: number;
}

export interface AgentLive {
  /** The agent's `name` in the graph: the exact string the server writes in `run_events.agent`. */
  name: string;
  status: AgentLiveStatus;
  /** Sum of the turns with a known price; `null` when no turn had one (unknown is never 0). */
  costUsd: number | null;
  turns: number;
  /** Turns whose cost was `null`: when above 0, `costUsd` is a lower bound. */
  unknownCostTurns: number;
  /** `seq` of the last event that involved the agent; 0 if none. */
  lastSeq: number;
  /** Why it failed, when `status` is `failed`. */
  failure: string | null;
  /**
   * Where `status` comes from: `event` once the agent reported an `AgentStateChanged` (T14b servers),
   * `deduced` while it is only inferred from the other events (runs recorded before T14b).
   */
  stateSource: "event" | "deduced";
}

export interface LiveMessage {
  seq: number;
  messageId: string;
  from: string;
  to: string;
  kind: LiveMessageKind;
  replyTo: string | null;
  /** First line(s) of the body, cut to `PREVIEW_MAX` characters. */
  preview: string;
  /** True once the recipient confirmed it received the message. */
  delivered: boolean;
  at: string;
}

export interface LiveGuardEvent {
  seq: number;
  type: "GuardTripped" | "GuardWarning";
  guard: string;
  agent: string | null;
  /** The pt-BR `reason` (tripped) or `message` (warning). */
  message: string;
  at: string;
}

export interface LiveToolCall {
  seq: number;
  agent: string | null;
  tool: string;
  path: string | null;
  ok: boolean;
  durationMs: number | null;
  errorCode: string | null;
  at: string;
}

export interface RunLiveFinish {
  seq: number;
  reason: "finished" | "quiescent" | "stopped" | "failed" | "guard_tripped";
  agent: string | null;
  result: string | null;
  error: string | null;
  guard: string | null;
  message: string | null;
}

export interface RunLiveTotals {
  /** Sum of the known costs of every agent (a lower bound when `unknownCostTurns` > 0). */
  costUsd: number;
  turns: number;
  unknownCostTurns: number;
}

export interface RunLiveState {
  /** `pending` until `RunStarted`, then `running` until `RunFinished`. */
  status: RunLiveStatus;
  finish: RunLiveFinish | null;
  input: string | null;
  budgetUsd: number | null;
  /** Highest `seq` applied; 0 when none. Events at or below it are ignored. */
  lastSeq: number;
  /** By agent name. */
  agents: Record<string, AgentLive>;
  /** Messages in `seq` order. */
  timeline: LiveMessage[];
  /** The latest messages (at most `MAX_PULSES`), oldest first. */
  pulses: LivePulse[];
  totals: RunLiveTotals;
  guardEvents: LiveGuardEvent[];
  toolCalls: LiveToolCall[];
  /** How many of the oldest entries were dropped from each list to keep memory bounded (`MAX_ACTIVITY`). */
  trimmed: { timeline: number; toolCalls: number; guardEvents: number };
  /** Raw terminal output by agent (escape sequences included), for the xterm.js panel. */
  terminals: Record<string, string>;
  /**
   * Bookkeeping that lets a terminal view write only what is new: `resets` counts the snapshots
   * (`replay: true`) that replaced the output; `total` counts every character appended since the last
   * reset, even the ones cut off the front of `terminals` by the size limit.
   */
  terminalMeta: Record<string, TerminalMeta>;
  /**
   * What each agent is writing right now, by agent name (live only, from `AgentOutputDelta`; never
   * in the log). Bounded: see `DRAFT_MAX_CHARS` and `MAX_MESSAGE_DRAFTS`.
   */
  drafts: Record<string, LiveDraft[]>;
}

/**
 * A text the model is still writing. `text` is its free text (it only reaches the screen);
 * `message` is the body of a message to another agent. The message that is finally sent replaces
 * the draft.
 */
export interface LiveDraft {
  turnId: string;
  channel: "text" | "message";
  /** The latest characters (at most `DRAFT_MAX_CHARS`); `cut` says the start was dropped. */
  body: string;
  cut: boolean;
}

export interface TerminalMeta {
  resets: number;
  total: number;
  /**
   * The size the server's terminal has now (the smallest among the viewers). Absent until the
   * server says (an older server never does: the terminal is then the 120x40 it opens with).
   */
  cols?: number;
  rows?: number;
}

/** An entry of the run log, as `GET /runs/{id}/events` and the WebSocket deliver it. */
export interface RunLogEvent {
  seq: number;
  type: string;
  agent: string | null;
  payload: unknown;
  at: string;
}

/** Terminal output pushed over `/ws` (`run.ephemeral`): never stored, no `seq`. */
export interface TerminalChunk {
  type: "TerminalOutput";
  agent: string;
  data: string;
  /** True for the snapshot sent after (re)subscribing: it replaces what was kept. */
  replay: boolean;
  /** On a snapshot: the size of the terminal it was printed at. */
  cols?: number;
  rows?: number;
}

/** The terminal of an agent has a new size, pushed over `/ws` (`run.ephemeral`). */
export interface TerminalSize {
  type: "TerminalResized";
  agent: string;
  cols: number;
  rows: number;
}

/** A piece of what an agent is writing, pushed over `/ws` (`run.ephemeral`): never stored, no `seq`. */
export interface AgentDeltaChunk {
  type: "AgentOutputDelta";
  agent: string;
  turnId: string;
  channel: "text" | "message";
  delta: string;
}

export type RunLiveEvent = RunLogEvent | TerminalChunk | TerminalSize | AgentDeltaChunk;
