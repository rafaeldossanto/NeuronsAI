import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AgentNode } from "@neurons/graph-schema";
import { findAgent } from "../hub/agent-lookup.js";
import { Hub, type UsageReport } from "../hub/hub.js";
import { RunRegistry } from "../hub/run-registry.js";
import { Supervisor, type StartedAgent } from "../hub/supervisor.js";
import { RUN_EVENT_HISTORY, type RunEventHistory } from "../realtime/run-event-history.js";
import { RunEventRecorder } from "../run-log/run-event-recorder.js";
import { GuardEnforcer } from "./guard-enforcer.js";
import { GuardEvents } from "./guard-events.js";
import { sumOf, totalsByAgent, USAGE_RECORDED } from "./usage-totals.js";

type WarningCode = "cost_unknown" | "runtime_without_cost";

/**
 * Spending limits: `budgetUsd` of an agent and of a run. The cost comes from the `UsageRecorded`
 * events (a runtime reports it after each turn) and is added up from the log every time, so a
 * restart or a late report never makes it drift.
 *
 * A cost that is not known is never counted as zero. It is counted apart (`unknownCostTurns`)
 * and, when a budget exists that this defeats, a `GuardWarning` says so once per agent: either the
 * runtime never reports a cost (the terminal in PTY mode) or one turn came without it.
 */
@Injectable()
export class BudgetGuard {
  private readonly logger = new Logger(BudgetGuard.name);
  private readonly warned = new Set<string>();

  constructor(
    @Inject(Hub) hub: Hub,
    @Inject(Supervisor) supervisor: Supervisor,
    @Inject(RunRegistry) private readonly registry: RunRegistry,
    @Inject(GuardEnforcer) private readonly enforcer: GuardEnforcer,
    @Inject(RunEventRecorder) private readonly recorder: RunEventRecorder,
    @Inject(RUN_EVENT_HISTORY) private readonly history: RunEventHistory,
  ) {
    hub.usageRecorded.subscribe((report) => this.onUsage(report));
    supervisor.agentStarted.subscribe((started) => this.onAgentStarted(started));
    supervisor.runStopped.subscribe((runId) => this.forget(runId));
  }

  private async onUsage({ runId, agent, usage }: UsageReport): Promise<void> {
    const context = this.registry.findOpen(runId);
    const node = context && findAgent(context.graph, agent);
    if (!context || !node) return;

    const runBudget = context.budgetUsd;
    if (usage.costUsd === undefined) {
      await this.warnOnce(
        runId,
        node,
        runBudget,
        "cost_unknown",
        `O turno de "${agent}" não informou o custo: ele fica de fora da soma e o orçamento pode não ser respeitado.`,
      );
    }
    if (node.budgetUsd === undefined && runBudget === undefined) return;

    const byAgent = totalsByAgent(await this.history.readByType(runId, USAGE_RECORDED));
    const spentByAgent = byAgent[agent]?.costUsd ?? 0;
    if (node.budgetUsd !== undefined && spentByAgent >= node.budgetUsd) {
      await this.enforcer.trip({
        runId,
        guard: "agent_budget",
        scope: "agent",
        agent,
        reason: `"${agent}" gastou US$ ${spentByAgent.toFixed(4)} e esgotou o orçamento de US$ ${node.budgetUsd}.`,
        data: { budgetUsd: node.budgetUsd, spentUsd: spentByAgent },
      });
    }
    const spentByRun = sumOf(Object.values(byAgent)).costUsd;
    if (runBudget !== undefined && spentByRun >= runBudget) {
      await this.enforcer.trip({
        runId,
        guard: "run_budget",
        scope: "run",
        reason: `A execução gastou US$ ${spentByRun.toFixed(4)} e esgotou o orçamento de US$ ${runBudget}.`,
        data: { budgetUsd: runBudget, spentUsd: spentByRun },
      });
    }
  }

  private async onAgentStarted({ runId, agent, runtime }: StartedAgent): Promise<void> {
    if (runtime.reportsCost) return;
    await this.warnOnce(
      runId,
      agent,
      this.registry.findOpen(runId)?.budgetUsd,
      "runtime_without_cost",
      `O runtime de "${agent.name}" não informa o custo: nenhum orçamento é aplicado a ele.`,
    );
  }

  /** Only when a budget exists that the unknown cost defeats. */
  private async warnOnce(
    runId: string,
    agent: AgentNode,
    runBudget: number | undefined,
    code: WarningCode,
    message: string,
  ): Promise<void> {
    if (agent.budgetUsd === undefined && runBudget === undefined) return;
    const key = `${runId}\u0000${agent.name}\u0000${code}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    const guard = agent.budgetUsd === undefined ? "run_budget" : "agent_budget";
    try {
      await this.recorder.record(runId, [GuardEvents.warning(guard, agent.name, code, message)]);
    } catch (error) {
      this.logger.error(
        `Não foi possível registrar o aviso de custo: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private forget(runId: string): void {
    for (const key of this.warned) if (key.startsWith(`${runId}\u0000`)) this.warned.delete(key);
  }
}
