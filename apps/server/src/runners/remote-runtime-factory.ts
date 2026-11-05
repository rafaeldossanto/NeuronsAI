import type {
  AgentCommunication,
  AgentRuntime,
  AgentRuntimeFactory,
} from "@neurons/agent-runtimes";
import { UnsupportedRuntimeError } from "@neurons/agent-runtimes";
import type { AgentNode } from "@neurons/graph-schema";
import { resourceScope } from "../accounts/resource-scope.js";
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
    const options = {
      ...this.options,
      ...(this.options.resolveSecret && {
        resolveSecret: resourceScope.bind((name: string) => this.options.resolveSecret!(name)),
      }),
    };
    const pool: RunnerPool = { acquire: resourceScope.bind(() => this.pool.acquire()) };
    return runtime.mode === "pty"
      ? new RemoteTerminalRuntime(agent, communication, pool, options)
      : new RemoteAgentRuntime(agent, communication, pool, options);
  }
}
