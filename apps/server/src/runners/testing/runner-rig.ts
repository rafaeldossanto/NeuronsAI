import type {
  AgentCommunication,
  AgentRuntime,
  AgentRuntimeFactory,
} from "@neurons/agent-runtimes";
import type { AgentNode } from "@neurons/graph-schema";
import { RunnerHost } from "@neurons/runner";
import { createMemoryChannelPair, type RunnerChannel } from "@neurons/runner-protocol";
import {
  FakeAgentRuntimeFactory,
  type FakeRuntimeOptions,
  type FakeScript,
} from "../../agents/testing/fake-agent-runtime.js";
import type { AppConfig } from "../../shared/config/app-config.js";
import { testConfig } from "../../shared/config/testing/test-config.js";
import { RemoteAgentRuntime } from "../remote-agent-runtime.js";
import { RunnerRegistry } from "../runner-registry.js";

export interface RunnerRigOptions {
  scripts?: Record<string, FakeScript>;
  runtimeOptions?: Record<string, FakeRuntimeOptions>;
  runners?: Partial<AppConfig["runners"]>;
  /** How long `stop` waits for the runner (tests keep it short). */
  stopWaitMs?: number;
}

/**
 * A server-side registry and a runner host wired through in-memory channels, the way the `local`
 * profile does it, but with a connection the test can cut and restore. The agents on the runner
 * side are scriptable fakes, so a test drives the whole path: Hub → remote runtime → protocol →
 * runner → fake agent, and back through the agent's tools.
 */
export function createRunnerRig(options: RunnerRigOptions = {}) {
  const config = testConfig({
    runners: { graceMs: 60_000, heartbeatMs: 15_000, waitMs: 500, ...options.runners },
  });
  const registry = new RunnerRegistry(config);
  const fakes = new FakeAgentRuntimeFactory(options.scripts, options.runtimeOptions);
  const newHost = () => new RunnerHost({ name: "rig", createFactory: () => fakes });
  let host = newHost();
  const identity = { id: "runner-rig", name: "rig" };

  let currentRunnerEnd: RunnerChannel | undefined;
  const connect = (): void => {
    const { server, runner } = createMemoryChannelPair();
    registry.accept(identity, server);
    host.attach(runner);
    currentRunnerEnd = runner;
  };

  /** What the Hub's Supervisor builds its agents with: every agent lives in the runner. */
  const factory: AgentRuntimeFactory = {
    create: (agent: AgentNode, communication: AgentCommunication): AgentRuntime =>
      new RemoteAgentRuntime(agent, communication, registry, {
        settings: { askTimeoutMs: config.askTimeoutMs, usageFlushMs: 0 },
        stopWaitMs: options.stopWaitMs ?? 2_000,
      }),
  };

  return {
    config,
    registry,
    get host(): RunnerHost {
      return host;
    },
    fakes,
    identity,
    factory,
    connect,
    /** The network fails: both ends see the connection close, the agents keep running. */
    sever: (): void => currentRunnerEnd?.close(1006, "queda de rede"),
    /** The runner process restarts: a new host that knows none of the agents. */
    restartRunner: (): void => {
      host.detach();
      host = newHost();
    },
    get link() {
      return registry.find(identity.id);
    },
    dispose: (): void => {
      host.detach();
      registry.onApplicationShutdown();
    },
  };
}
