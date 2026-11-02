import { Inject, Injectable } from "@nestjs/common";
import type { AgentRuntimeState } from "@neurons/agent-runtimes";
import { findAgent } from "../hub/agent-lookup.js";
import { Hub, type AgentActivity } from "../hub/hub.js";
import { RunRegistry } from "../hub/run-registry.js";
import { Supervisor, type AgentStateChange } from "../hub/supervisor.js";
import { GuardEnforcer } from "./guard-enforcer.js";

/** `waiting_reply` is not working: the agent is held by an `ask`, which has its own timeout. */
const isWorking = (state: AgentRuntimeState): boolean => state === "busy";

const keyOf = (runId: string, agent: string): string => `${runId}\u0000${agent}`;

/**
 * `idleTimeoutSec` of an agent: how long it may stay busy without a sign of life. Every message,
 * question, answer, usage report, `list_peers` and `finish` it makes starts the time over. While it
 * waits for the answer to its own `ask` the clock is stopped. When the time runs out the agent is
 * stopped, not the run: the others can go on or settle.
 */
@Injectable()
export class IdleWatchdog {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @Inject(Hub) hub: Hub,
    @Inject(Supervisor) supervisor: Supervisor,
    @Inject(RunRegistry) private readonly registry: RunRegistry,
    @Inject(GuardEnforcer) private readonly enforcer: GuardEnforcer,
  ) {
    supervisor.agentStateChanged.subscribe((change) => this.onState(change));
    supervisor.runStopped.subscribe((runId) => this.disarmRun(runId));
    hub.agentActive.subscribe((activity) => this.onActivity(activity));
  }

  private onState({ runId, agent, state }: AgentStateChange): void {
    if (isWorking(state)) this.arm(runId, agent);
    else this.disarm(runId, agent);
  }

  private onActivity({ runId, agent }: AgentActivity): void {
    if (this.timers.has(keyOf(runId, agent))) this.arm(runId, agent);
  }

  private arm(runId: string, agent: string): void {
    this.disarm(runId, agent);
    const graph = this.registry.findOpen(runId)?.graph;
    const seconds = graph && findAgent(graph, agent)?.idleTimeoutSec;
    if (!seconds) return;
    const timer = setTimeout(() => this.expire(runId, agent, seconds), seconds * 1000);
    timer.unref();
    this.timers.set(keyOf(runId, agent), timer);
  }

  private disarm(runId: string, agent: string): void {
    const key = keyOf(runId, agent);
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
  }

  private disarmRun(runId: string): void {
    for (const key of [...this.timers.keys()]) {
      if (!key.startsWith(`${runId}\u0000`)) continue;
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
  }

  private expire(runId: string, agent: string, seconds: number): void {
    this.timers.delete(keyOf(runId, agent));
    void this.enforcer.trip({
      runId,
      guard: "idle_timeout",
      scope: "agent",
      agent,
      reason: `"${agent}" ficou ${seconds} s sem dar sinal de vida e foi parado.`,
      data: { idleTimeoutSec: seconds },
    });
  }
}
