import { Inject, Injectable } from "@nestjs/common";
import { Subject } from "rxjs";
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
import { resourceScope } from "../accounts/resource-scope.js";
import { GraphNotFoundError, SecretPublishForbiddenError } from "./graphs.errors.js";

const SECRET_PLACEHOLDER = /\{\{secret:[A-Za-z0-9_.-]+\}\}/;

/** True when any string of the definition references a stored secret. */
export function usesSecrets(definition: unknown): boolean {
  return SECRET_PLACEHOLDER.test(JSON.stringify(definition) ?? "");
}

export type PublishResult =
  { ok: true; version: GraphVersionRecord } | { ok: false; issues: GraphIssue[] };

@Injectable()
export class GraphVersionService {
  /** Emits after a version is stored, so what depends on the latest version (schedules) can follow it. */
  readonly published = new Subject<{ graphId: string; version: number }>();

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

    this.requireSecretPublisher(validation.graph);

    const version = await this.versions.appendNext(graphId, validation.graph);
    this.published.next({ graphId, version: version.version });
    return { ok: true, version };
  }

  /**
   * On a server with accounts a `member` could otherwise point an HTTP tool at their own host and
   * put `{{secret:NAME}}` in the URL or a header, sending the organization's secret out. The local
   * workspace (no organization) has a single user, who owns every secret anyway.
   */
  private requireSecretPublisher(graph: GraphDefinition): void {
    const { organizationId, role } = resourceScope.current();
    if (organizationId === null || !usesSecrets(graph)) return;
    if (role !== "owner" && role !== "admin") throw new SecretPublishForbiddenError();
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
