import type { RunEvent } from "./run-event.js";

/** Read side of the run log, used to catch a reconnecting client up. */
export interface RunEventHistory {
  /** Events of the run with `seq >= fromSeq`, ascending; at most `limit` when given. */
  readFrom(runId: string, fromSeq: number, limit?: number): Promise<RunEvent[]>;

  /** Every event of the run of that type, ascending. */
  readByType(runId: string, type: string): Promise<RunEvent[]>;
}

export const RUN_EVENT_HISTORY = Symbol("RUN_EVENT_HISTORY");
