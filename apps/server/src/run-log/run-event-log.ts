import type { RunEvent } from "../realtime/run-event.js";
import type { RunEventDraft } from "./run-event-draft.js";

/** Append-only log of a run. Seqs are allocated by the log itself, never by the caller. */
export interface RunEventLog {
  /** Stores the events with consecutive seqs; they become visible together. */
  append(runId: string, drafts: RunEventDraft[]): Promise<RunEvent[]>;
}

export const RUN_EVENT_LOG = Symbol("RUN_EVENT_LOG");
