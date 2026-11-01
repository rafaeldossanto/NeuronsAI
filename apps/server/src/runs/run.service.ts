import { Inject, Injectable } from "@nestjs/common";
import type { GraphDefinition, TriggerNode } from "@neurons/graph-schema";
import {
  GRAPH_VERSION_REPOSITORY,
  type GraphVersionRepository,
} from "../graphs/graph-version-repository.js";
import { TRIGGER } from "../hub/addresses.js";
import { Hub } from "../hub/hub.js";
import { RunRegistry } from "../hub/run-registry.js";
import { Supervisor } from "../hub/supervisor.js";
import { RunEventRecorder } from "../run-log/run-event-recorder.js";
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
  GraphVersionNotFoundError,
  TriggerSelectionError,
  TriggerTargetNotFoundError,
} from "./runs.errors.js";

const STATUS_BY_REASON: Record<RunFinishReason, FinalRunStatus> = {
  finished: "succeeded",
  quiescent: "succeeded",
  stopped: "cancelled",
  failed: "failed",
};

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
  ) {
    this.hub.finishRequested.subscribe(({ runId, agent, result }) =>
      this.end(runId, "finished", { agent, result }),
    );
    this.supervisor.settled.subscribe((runId) => this.endIfQuiescent(runId));
  }

  /**
   * Creates the run and sends the trigger's first message (`input`) to its target agent.
   * @param options.triggerId Which trigger to use; optional when the graph has only one.
   */
  async start(
    graphVersionId: string,
    input: string,
    options: { triggerId?: string } = {},
  ): Promise<RunRecord> {
    const version = await this.versions.findById(graphVersionId);
    if (!version) throw new GraphVersionNotFoundError(graphVersionId);

    const graph = version.definition;
    const trigger = pickTrigger(graph, options.triggerId);
    const target = graph.nodes.find((node) => node.type === "agent" && node.id === trigger.target);
    if (target?.type !== "agent") throw new TriggerTargetNotFoundError(trigger.id);

    const { record: run, events } = await this.runs.createRunning(version.id, () => [
      RunLifecycleEvents.runStarted({ graphVersionId: version.id, triggerId: trigger.id, input }),
    ]);
    this.recorder.publish(events);

    this.registry.register(run.id, graph);
    try {
      await this.hub.send(run.id, TRIGGER, target.name, "message", input);
    } catch (error) {
      await this.end(run.id, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
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

  private async end(
    runId: string,
    reason: RunFinishReason,
    details: RunFinishDetails = {},
  ): Promise<void> {
    // Taking the run out of the registry first shuts the door for new messages and makes
    // concurrent attempts to end it (e.g. `finish` racing with quiescence) harmless.
    const wasActive = this.registry.remove(runId);
    if (!wasActive && reason !== "stopped") return;
    try {
      const finished = await this.runs.finish(runId, STATUS_BY_REASON[reason], [
        RunLifecycleEvents.runFinished(reason, details),
      ]);
      if (finished) this.recorder.publish(finished.events);
    } finally {
      this.hub.cancelAsks(runId);
      await this.supervisor.stopRun(runId);
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
