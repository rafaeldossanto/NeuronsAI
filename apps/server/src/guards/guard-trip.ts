export const GUARD_KINDS = [
  "run_max_messages",
  "link_max_messages",
  "ping_pong",
  "run_budget",
  "agent_budget",
  "idle_timeout",
] as const;
export type GuardKind = (typeof GUARD_KINDS)[number];

/** What a tripped guard stops: the whole run, or only the agent it names. */
export type GuardScope = "run" | "agent";

/** What a guard knows when it trips, before anybody asks which run it was. */
export interface GuardTripDetails {
  guard: GuardKind;
  scope: GuardScope;
  /** The agent that is stopped (`scope` "agent"). */
  agent?: string;
  /** Why, for the user (pt-BR). */
  reason: string;
  /** Machine-readable numbers behind the reason (the limit, what was counted...). */
  data?: Record<string, unknown>;
}

export interface GuardTrip extends GuardTripDetails {
  runId: string;
}
