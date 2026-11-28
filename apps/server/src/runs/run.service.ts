import { usesSecrets } from "../graphs/graph-version.service.js";
import { SecretPublishForbiddenError } from "../graphs/graphs.errors.js";
import { Inject, Injectable } from "@nestjs/common";
import { DEFAULT_QUOTAS } from "../shared/config/quota-config.js";
import type { RunQuotas } from "../run-log/run-quota.js";
import { resourceScope } from "../accounts/resource-scope.js";
import type { ChatMessageContext } from "@neurons/agent-runtimes";
import type { AgentNode, GraphDefinition, TriggerNode } from "@neurons/graph-schema";
import type { GraphVersionRecord } from "../graphs/graph.records.js";
import {
  GRAPH_VERSION_REPOSITORY,
  type GraphVersionRepository,
} from "../graphs/graph-version-repository.js";
import { GuardEnforcer } from "../guards/guard-enforcer.js";
import { HUMAN, TRIGGER } from "../hub/addresses.js";
import { Hub } from "../hub/hub.js";
import { RunRegistry } from "../hub/run-registry.js";
import { Supervisor } from "../hub/supervisor.js";
import { RunEventRecorder } from "../run-log/run-event-recorder.js";
import { DomainError } from "../shared/errors/domain-error.js";
import {
  RUN_REPOSITORY,
  type FinalRunStatus,
  type RunRecord,
  type RunRepository,
} from "../run-log/run-repository.js";
import {
  RunLifecycleEvents,
  type RunFinishDetails,
  type RunFinishReason,
} from "./run-lifecycle-events.js";
import {
  AgentChatDispatchError,
  GraphVersionNotFoundError,
  TriggerSelectionError,
  TriggerTargetNotFoundError,
} from "./runs.errors.js";

const STATUS_BY_REASON: Record<RunFinishReason, FinalRunStatus> = {
  finished: "succeeded",
  quiescent: "succeeded",
  stopped: "cancelled",
  failed: "failed",
  guard_tripped: "failed",
};

export interface RunServiceOptions {
  /** Spending limit of a run that does not set its own. */
  defaultBudgetUsd?: number;
  /** Per-organization limits on runs; absent means the defaults. They never apply to the local workspace. */
  quotas?: RunQuotas;
}

export const RUN_SERVICE_OPTIONS = Symbol("RUN_SERVICE_OPTIONS");

/**
 * Starts runs and ends them. A run ends when an agent calls `finish`, when it goes quiescent
 * (everyone idle, no message pending, no `ask` open) or when it is stopped by hand. Ending stops
 * every runtime.
 */
@Injectable()
export class RunService {
  constructor(
    @Inject(RUN_REPOSITORY) private readonly runs: RunRepository,
    @Inject(GRAPH_VERSION_REPOSITORY) private readonly versions: GraphVersionRepository,
    @Inject(RunRegistry) private readonly registry: RunRegistry,
    @Inject(Hub) private readonly hub: Hub,
    @Inject(Supervisor) private readonly supervisor: Supervisor,
    @Inject(RunEventRecorder) private readonly recorder: RunEventRecorder,
    @Inject(GuardEnforcer) private readonly enforcer: GuardEnforcer,
    @Inject(RUN_SERVICE_OPTIONS) private readonly options: RunServiceOptions,
  ) {
    this.hub.finishRequested.subscribe(({ runId, agent, result }) =>
      this.end(runId, "finished", { agent, result }),
    );
    this.enforcer.tripped.subscribe((trip) => {
      if (trip.scope === "run") {
        return this.end(trip.runId, "guard_tripped", { guard: trip.guard, message: trip.reason });
      }
    });
    this.supervisor.settled.subscribe((runId) => this.endIfQuiescent(runId));
  }

  /**
   * Creates the run and sends the trigger's first message (`input`) to its target agent.
   * @param options.triggerId Which trigger to use; optional when the graph has only one.
   * @param options.budgetUsd Spending limit of the run; the server's default applies when absent.
   * @param options.startedByUserId The signed-in user who asked for it; triggers leave it out.
   */
  async start(
    graphVersionId: string,
    input: string,
    options: { triggerId?: string; budgetUsd?: number; startedByUserId?: string } = {},
  ): Promise<RunRecord> {
    const version = await this.versions.findById(graphVersionId);
    if (!version) throw new GraphVersionNotFoundError(graphVersionId);

    this.assertCredentialsApproved(version);
    const graph = version.definition;
    const trigger = pickTrigger(graph, options.triggerId);
    const target = graph.nodes.find((node) => node.type === "agent" && node.id === trigger.target);
    if (target?.type !== "agent") throw new TriggerTargetNotFoundError(trigger.id);

    return this.launch(version, target, input, { triggerId: trigger.id }, options);
  }

  /** Creates an execution of the whole graph, addressed directly to one agent. */
  async startChat(
    version: GraphVersionRecord,
    target: AgentNode,
    input: string,
    prepareChat: () => Promise<ChatMessageContext>,
  ): Promise<RunRecord> {
    this.assertCredentialsApproved(version);
    const { userId: startedByUserId } = resourceScope.current();
    return this.launch(
      version,
      target,
      input,
      { chatAgentId: target.id },
      {
        ...(startedByUserId && { startedByUserId }),
        prepareChat,
      },
    );
  }

  private assertCredentialsApproved(version: GraphVersionRecord): void {
    // Historical versions require republishing with the corrected authorization.
    if (
      resourceScope.current().organizationId !== null &&
      usesSecrets(version.definition) &&
      !version.credentialsApproved
    )
      throw new SecretPublishForbiddenError();
  }

  private async launch(
    version: GraphVersionRecord,
    target: AgentNode,
    input: string,
    source: { triggerId: string; chatAgentId?: never } | { chatAgentId: string; triggerId?: never },
    options: {
      budgetUsd?: number;
      startedByUserId?: string;
      prepareChat?: () => Promise<ChatMessageContext>;
    } = {},
  ): Promise<RunRecord> {
    const { startedByUserId, prepareChat } = options;
    const budgetUsd = options.budgetUsd ?? this.options.defaultBudgetUsd;
    const { record: run, events } = await this.runs.createRunning(
      version.id,
      () => [
        RunLifecycleEvents.runStarted({
          graphVersionId: version.id,
          ...source,
          input,
          budgetUsd: budgetUsd ?? null,
        }),
      ],
      {
        ...(budgetUsd !== undefined && { budgetUsd }),
        ...(startedByUserId && { startedByUserId }),
        ...(source.chatAgentId !== undefined && { chatAgentId: source.chatAgentId }),
        // Checked by the repository in the transaction that creates the run (see createRunning). The
        // local workspace has no organization and no limits.
        ...(resourceScope.current().organizationId !== null && {
          quotas: this.options.quotas ?? DEFAULT_QUOTAS,
        }),
      },
    );
    this.recorder.publish(events);

    this.registry.register(run.id, version.definition, budgetUsd, startedByUserId);
    try {
      const chat = await prepareChat?.();
      await this.hub.send(
        run.id,
        chat ? HUMAN : TRIGGER,
        target.name,
        "message",
        input,
        chat && { chat },
      );
    } catch (error) {
      // Storage errors can quote the original query parameters, including image bytes.
      const failure =
        prepareChat && !(error instanceof DomainError) ? new AgentChatDispatchError() : error;
      await this.end(run.id, "failed", {
        error: failure instanceof Error ? failure.message : String(failure),
      });
      throw failure;
    }
    return run;
  }

  /** Stops the run by hand. Does nothing if it already ended. */
  stop(runId: string): Promise<void> {
    return this.end(runId, "stopped");
  }

  private async endIfQuiescent(runId: string): Promise<void> {
    if (!this.registry.find(runId)) return;
    if (await this.supervisor.isQuiescent(runId)) await this.end(runId, "quiescent");
  }

  private end(
    runId: string,
    reason: RunFinishReason,
    details: RunFinishDetails = {},
  ): Promise<void> {
    const owner = this.registry.findOpen(runId);
    const scope = owner ? { organizationId: owner.organizationId } : resourceScope.current();
    return resourceScope.run(scope, () => this.endScoped(runId, reason, details));
  }

  private async endScoped(
    runId: string,
    reason: RunFinishReason,
    details: RunFinishDetails = {},
  ): Promise<void> {
    // Closing the run first shuts the door for new messages and makes concurrent attempts to end
    // it (e.g. `finish` racing with quiescence) harmless. Agents winding down may still report
    // their last usage.
    const wasActive = this.registry.close(runId);
    if (!wasActive && reason !== "stopped") return;
    try {
      this.hub.cancelAsks(runId);
      // Before the run is marked as finished: the last turn's usage lands in the log first.
      await this.supervisor.stopRun(runId);
    } finally {
      try {
        const finished = await this.runs.finish(runId, STATUS_BY_REASON[reason], [
          RunLifecycleEvents.runFinished(reason, details),
        ]);
        if (finished) this.recorder.publish(finished.events);
      } finally {
        this.registry.release(runId);
        this.enforcer.forget(runId);
      }
    }
  }
}

function pickTrigger(graph: GraphDefinition, triggerId: string | undefined): TriggerNode {
  const triggers = graph.nodes.filter((node): node is TriggerNode => node.type === "trigger");
  if (triggerId) {
    const chosen = triggers.find((trigger) => trigger.id === triggerId);
    if (!chosen) throw new TriggerSelectionError(`O gatilho "${triggerId}" não existe no grafo.`);
    return chosen;
  }
  const [only, ...others] = triggers;
  if (!only) throw new TriggerSelectionError("O grafo não tem gatilho para iniciar a execução.");
  if (others.length > 0) {
    throw new TriggerSelectionError("O grafo tem mais de um gatilho; informe qual usar.");
  }
  return only;
}
