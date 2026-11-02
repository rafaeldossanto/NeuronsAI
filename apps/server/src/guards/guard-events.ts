import type { RunEventDraft } from "../run-log/run-event-draft.js";
import type { GuardKind, GuardTrip } from "./guard-trip.js";

/** The events the guards write to the run log, so a stop is never silent. */
export const GuardEvents = {
  /** A guard stopped the run or an agent. */
  tripped: (trip: GuardTrip): RunEventDraft => ({
    type: "GuardTripped",
    agent: trip.agent ?? null,
    payload: { guard: trip.guard, scope: trip.scope, reason: trip.reason, ...trip.data },
  }),

  /** A guard cannot do its job (e.g. the cost of an agent is unknown), so the user knows it is not protecting. */
  warning: (guard: GuardKind, agent: string, code: string, message: string): RunEventDraft => ({
    type: "GuardWarning",
    agent,
    payload: { guard, code, message },
  }),
};
