/** One entry of a run's event log, as pushed to subscribers. */
export interface RunEvent {
  runId: string;
  /** Monotonic per run; clients resume from it after a reconnection. */
  seq: number;
  type: string;
  agent: string | null;
  payload: unknown;
  at: Date;
}

/**
 * Something shown live but never stored in the run log, so it has no `seq` and cannot be replayed
 * from history: a client that missed it simply does not get it (the terminal output is the case;
 * late joiners receive a snapshot instead).
 */
export type EphemeralRunEvent = TerminalOutputEvent | TerminalResizedEvent | AgentOutputDeltaEvent;

/**
 * A piece of what an agent is writing while the model generates it (API and stream-json agents).
 * `channel: "text"` is the model's free text (it never reaches another agent); `"message"` is the
 * body of a `send_message`/`reply`/`ask` still being written. `turnId` ties the pieces of one text
 * together; the message that is finally sent enters the log as always, and replaces the draft.
 * Pieces are grouped (about every 50 ms), never stored, and a late subscriber does not get them.
 */
export interface AgentOutputDeltaEvent {
  runId: string;
  type: "AgentOutputDelta";
  agent: string;
  turnId: string;
  channel: "text" | "message";
  delta: string;
  at: Date;
}

export interface TerminalOutputEvent {
  runId: string;
  type: "TerminalOutput";
  agent: string;
  /** Raw terminal output, escape sequences included. */
  data: string;
  /** True for the snapshot sent to a client that subscribed after the output began. */
  replay: boolean;
  /**
   * Only on a replay: the size of the terminal the snapshot was produced at, so the client draws
   * it on a screen of that size before writing it (see `TerminalAgentRuntime.outputSnapshot`).
   */
  cols?: number;
  rows?: number;
  at: Date;
}

/** The terminal of an agent has a new size (the rule for several viewers is in `terminal-size.ts`). */
export interface TerminalResizedEvent {
  runId: string;
  type: "TerminalResized";
  agent: string;
  cols: number;
  rows: number;
  at: Date;
}

/** Where events are delivered; the WebSocket gateway adapts a socket to this. */
export interface EventSink {
  send(event: RunEvent): void;
  sendEphemeral(event: EphemeralRunEvent): void;
}
