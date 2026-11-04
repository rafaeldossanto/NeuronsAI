import type { AgentRuntimeState } from "@neurons/agent-runtimes";

/**
 * The states of an agent as the run log tells them (`AgentStateChanged`). Not the runtime's own
 * list: `stopped` reads as `finished` here (the run is over for the agent), and `waiting_reply` is
 * decided by the Hub's count of open asks, not by what a runtime says.
 */
export const AGENT_LIFECYCLE_STATES = [
  "starting",
  "busy",
  "idle",
  "waiting_reply",
  "failed",
  "finished",
] as const;
export type AgentLifecycleState = (typeof AGENT_LIFECYCLE_STATES)[number];

/**
 * The lifecycle state for a runtime state. A working runtime (`busy` or `waiting_reply`) is
 * `waiting_reply` for as long as the agent has an `ask` open, however many, and `busy` otherwise.
 */
export function lifecycleStateOf(
  runtime: AgentRuntimeState,
  openAsks: number,
): AgentLifecycleState {
  switch (runtime) {
    case "busy":
    case "waiting_reply":
      return openAsks > 0 ? "waiting_reply" : "busy";
    case "stopped":
      return "finished";
    case "starting":
    case "idle":
    case "failed":
      return runtime;
  }
}
