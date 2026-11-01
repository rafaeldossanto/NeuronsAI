import type { RunEventDraft } from "../run-log/run-event-draft.js";

export type RunFinishReason = "finished" | "quiescent" | "stopped" | "failed";

export interface RunFinishDetails {
  /** The agent that called `finish`. */
  agent?: string;
  result?: string;
  error?: string;
}

/** The events that open and close a run. */
export const RunLifecycleEvents = {
  runStarted: (payload: {
    graphVersionId: string;
    triggerId: string;
    input: string;
  }): RunEventDraft => ({ type: "RunStarted", payload }),

  runFinished: (reason: RunFinishReason, details: RunFinishDetails = {}): RunEventDraft => ({
    type: "RunFinished",
    agent: details.agent ?? null,
    payload: { reason, ...details },
  }),
};
