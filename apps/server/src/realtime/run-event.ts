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

/** Where events are delivered; the WebSocket gateway adapts a socket to this. */
export interface EventSink {
  send(event: RunEvent): void;
}
