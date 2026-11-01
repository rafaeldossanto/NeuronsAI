import { Inject, Injectable } from "@nestjs/common";
import {
  createIssue,
  validateGraph,
  type GraphDefinition,
  type GraphIssue,
} from "@neurons/graph-schema";
import { GRAPH_REPOSITORY, type GraphRepository } from "./graph-repository.js";
import {
  GRAPH_VERSION_REPOSITORY,
  type GraphVersionRepository,
} from "./graph-version-repository.js";
import type { GraphVersionRecord } from "./graph.records.js";
import { GraphNotFoundError } from "./graphs.errors.js";

export type PublishResult =
  { ok: true; version: GraphVersionRecord } | { ok: false; issues: GraphIssue[] };

@Injectable()
export class GraphVersionService {
  constructor(
    @Inject(GRAPH_REPOSITORY) private readonly graphs: GraphRepository,
    @Inject(GRAPH_VERSION_REPOSITORY) private readonly versions: GraphVersionRepository,
  ) {}

  /**
   * Validates the definition and stores it as the next immutable version of the graph.
   * An invalid definition is not an exception: the caller gets the issues to show the user.
   * @throws GraphNotFoundError when `graphId` does not exist.
   */
  async publish(graphId: string, definition: unknown): Promise<PublishResult> {
    if (!(await this.graphs.findById(graphId))) throw new GraphNotFoundError(graphId);

    const validation = validateGraph(definition);
    if (!validation.ok) return validation;

    const mismatch = this.checkGraphId(graphId, validation.graph);
    if (mismatch) return { ok: false, issues: [mismatch] };

    return { ok: true, version: await this.versions.appendNext(graphId, validation.graph) };
  }

  /** The id inside the definition must be the id of the graph it is published to. */
  private checkGraphId(graphId: string, graph: GraphDefinition): GraphIssue | undefined {
    if (graph.id === graphId) return undefined;
    return createIssue(
      "graph_id_mismatch",
      "O id do grafo na definição não corresponde ao grafo em que está sendo publicado.",
      { path: ["id"] },
    );
  }
}
