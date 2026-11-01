import type { RunEvent } from "./run-event.js";

/** Read side of the run log, used to catch a reconnecting client up. */
export interface RunEventHistory {
  /** Events of the run with `seq >= fromSeq`, ascending. */
  readFrom(runId: string, fromSeq: number): Promise<RunEvent[]>;
}

export const RUN_EVENT_HISTORY = Symbol("RUN_EVENT_HISTORY");
