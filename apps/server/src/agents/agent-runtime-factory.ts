import { Injectable } from "@nestjs/common";
import type { AgentNode } from "@neurons/graph-schema";
import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";
import type { AgentCommunication } from "./agent-communication.js";
import type { AgentRuntime } from "./agent-runtime.js";

/** Builds the runtime that matches the agent's configuration (API, terminal...). */
export interface AgentRuntimeFactory {
  create(agent: AgentNode, communication: AgentCommunication): AgentRuntime;
}

export const AGENT_RUNTIME_FACTORY = Symbol("AGENT_RUNTIME_FACTORY");

export class RuntimeUnavailableError extends DomainError {
  readonly kind: DomainErrorKind = "unavailable";

  constructor(agentName: string, runtimeKind: string) {
    super(
      "runtime_unavailable",
      `O agente "${agentName}" usa o runtime "${runtimeKind}", que ainda não está disponível neste servidor.`,
    );
  }
}

/** Placeholder until the API (T07) and terminal (T08) runtimes exist. */
@Injectable()
export class UnavailableAgentRuntimeFactory implements AgentRuntimeFactory {
  create(agent: AgentNode): AgentRuntime {
    throw new RuntimeUnavailableError(agent.name, agent.runtime.kind);
  }
}
