import { Injectable } from "@nestjs/common";
import type { AgentCommunication, AgentRuntime, AgentRuntimeFactory } from "@neurons/agent-runtimes";
import type { AgentNode } from "@neurons/graph-schema";
import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";

export const AGENT_RUNTIME_FACTORY = Symbol("AGENT_RUNTIME_FACTORY");

export type AgentRuntimeKind = AgentNode["runtime"]["kind"];

export class RuntimeUnavailableError extends DomainError {
  readonly kind: DomainErrorKind = "unavailable";

  constructor(agentName: string, runtimeKind: string) {
    super(
      "runtime_unavailable",
      `O agente "${agentName}" usa o runtime "${runtimeKind}", que ainda não está disponível neste servidor.`,
    );
  }
}

/**
 * Picks the factory that matches the agent's `runtime.kind`; a kind with no factory yet (the API
 * runtime, T07) is reported as unavailable. Each kind's factory decides the rest (CLI, mode...).
 */
@Injectable()
export class RoutingAgentRuntimeFactory implements AgentRuntimeFactory {
  constructor(private readonly byKind: Partial<Record<AgentRuntimeKind, AgentRuntimeFactory>>) {}

  create(agent: AgentNode, communication: AgentCommunication): AgentRuntime {
    const factory = this.byKind[agent.runtime.kind];
    if (!factory) throw new RuntimeUnavailableError(agent.name, agent.runtime.kind);
    return factory.create(agent, communication);
  }
}
