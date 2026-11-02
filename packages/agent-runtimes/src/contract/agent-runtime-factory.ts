import type { AgentNode } from "@neurons/graph-schema";
import type { AgentCommunication } from "./agent-communication.js";
import type { AgentRuntime } from "./agent-runtime.js";

/** Builds the runtime that matches the agent's configuration (API, terminal...). */
export interface AgentRuntimeFactory {
  /** @throws when the agent's runtime configuration is not supported here. */
  create(agent: AgentNode, communication: AgentCommunication): AgentRuntime;
}

/** The agent asks for a runtime this build cannot provide; the message is meant for the user. */
export class UnsupportedRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedRuntimeError";
  }
}
