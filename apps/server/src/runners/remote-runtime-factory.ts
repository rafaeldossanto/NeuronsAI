import type {
  AgentCommunication,
  AgentRuntime,
  AgentRuntimeFactory,
} from "@neurons/agent-runtimes";
import { UnsupportedRuntimeError } from "@neurons/agent-runtimes";
import type { AgentNode } from "@neurons/graph-schema";
import {
  RemoteAgentRuntime,
  RemoteTerminalRuntime,
  type RemoteRuntimeOptions,
  type RunnerPool,
} from "./remote-agent-runtime.js";

/**
 * Builds the runtimes of the agents that run in a runner. Today that is the `terminal` kind (the
 * Claude Code CLI, as a PTY or as stream-json); the API runtime (T07) lives in this process.
 */
export class RemoteRuntimeFactory implements AgentRuntimeFactory {
  constructor(
    private readonly pool: RunnerPool,
    private readonly options: RemoteRuntimeOptions,
  ) {}

  create(agent: AgentNode, communication: AgentCommunication): AgentRuntime {
    const runtime = agent.runtime;
    if (runtime.kind !== "terminal") {
      throw new UnsupportedRuntimeError(
        `O agente "${agent.name}" usa o runtime "${runtime.kind}", que não roda em um runner.`,
      );
    }
    return runtime.mode === "pty"
      ? new RemoteTerminalRuntime(agent, communication, this.pool, this.options)
      : new RemoteAgentRuntime(agent, communication, this.pool, this.options);
  }
}
