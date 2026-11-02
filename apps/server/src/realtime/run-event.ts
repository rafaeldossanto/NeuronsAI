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
export interface EphemeralRunEvent {
  runId: string;
  type: "TerminalOutput";
  agent: string;
  /** Raw terminal output, escape sequences included. */
  data: string;
  /** True for the snapshot sent to a client that subscribed after the output began. */
  replay: boolean;
  at: Date;
}

/** Where events are delivered; the WebSocket gateway adapts a socket to this. */
export interface EventSink {
  send(event: RunEvent): void;
  sendEphemeral(event: EphemeralRunEvent): void;
}
