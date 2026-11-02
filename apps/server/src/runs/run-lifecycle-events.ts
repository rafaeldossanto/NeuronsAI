import type { RunEventDraft } from "../run-log/run-event-draft.js";

export type RunFinishReason = "finished" | "quiescent" | "stopped" | "failed" | "guard_tripped";

export interface RunFinishDetails {
  /** The agent that called `finish`. */
  agent?: string;
  result?: string;
  error?: string;
  /** The guard that stopped the run (`guard_tripped`) and why, for the user. */
  guard?: string;
  message?: string;
}

/** The events that open and close a run. */
export const RunLifecycleEvents = {
  runStarted: (payload: {
    graphVersionId: string;
    triggerId: string;
    input: string;
    /** Spending limit of the run; null means none. */
    budgetUsd: number | null;
  }): RunEventDraft => ({ type: "RunStarted", payload }),

  runFinished: (reason: RunFinishReason, details: RunFinishDetails = {}): RunEventDraft => ({
    type: "RunFinished",
    agent: details.agent ?? null,
    payload: { reason, ...details },
  }),
};
