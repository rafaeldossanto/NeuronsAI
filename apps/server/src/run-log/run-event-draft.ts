import type { RunEvent } from "../realtime/run-event.js";

/** An event before it gets its `seq` and timestamp. */
export interface RunEventDraft {
  type: string;
  agent?: string | null;
  payload: unknown;
}

/** Something that was just stored together with the events written in the same transaction. */
export interface Recorded<T> {
  record: T;
  events: RunEvent[];
}
