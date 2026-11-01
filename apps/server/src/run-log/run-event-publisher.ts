import type { RunEvent } from "../realtime/run-event.js";

/** Pushes committed events to whoever watches the run (the realtime gateway). */
export interface RunEventPublisher {
  publish(event: RunEvent): void;
}

export const RUN_EVENT_PUBLISHER = Symbol("RUN_EVENT_PUBLISHER");
