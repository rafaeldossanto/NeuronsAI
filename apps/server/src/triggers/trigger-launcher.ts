import { Inject, Injectable } from "@nestjs/common";
import type { TriggerNode } from "@neurons/graph-schema";
import {
  GRAPH_VERSION_REPOSITORY,
  type GraphVersionRepository,
} from "../graphs/graph-version-repository.js";
import type { GraphVersionRecord } from "../graphs/graph.records.js";
import type { RunRecord } from "../run-log/run-repository.js";
import { RunService } from "../runs/run.service.js";
import { NoPublishedVersionError, TriggerNotInVersionError } from "./triggers.errors.js";

export type ExternalTriggerKind = "webhook" | "schedule" | "whatsapp";

/**
 * What an external trigger runs: always the **latest published version** of its graph, read at the
 * moment it fires, so publishing a new version changes what the next call executes. A graph with
 * no published version cannot be run by a trigger.
 */
@Injectable()
export class TriggerLauncher {
  constructor(
    @Inject(GRAPH_VERSION_REPOSITORY) private readonly versions: GraphVersionRepository,
    @Inject(RunService) private readonly runs: RunService,
  ) {}

  /** The latest version and the trigger block in it, or the reason the trigger cannot run. */
  async resolve(
    graphId: string,
    triggerId: string,
    kind?: ExternalTriggerKind,
  ): Promise<{ version: GraphVersionRecord; trigger: TriggerNode }> {
    const version = await this.versions.findLatest(graphId);
    if (!version) throw new NoPublishedVersionError();
    const trigger = version.definition.nodes.find(
      (node): node is TriggerNode =>
        node.type === "trigger" &&
        node.id === triggerId &&
        (kind === undefined ? node.kind !== "manual" : node.kind === kind),
    );
    if (!trigger) throw new TriggerNotInVersionError(triggerId, kind);
    return { version, trigger };
  }

  /** Starts a run of the latest version with `input` as the trigger's first message. */
  async launch(
    graphId: string,
    triggerId: string,
    kind: ExternalTriggerKind,
    input: string,
  ): Promise<RunRecord> {
    const { version } = await this.resolve(graphId, triggerId, kind);
    return this.runs.start(version.id, input, { triggerId });
  }
}
