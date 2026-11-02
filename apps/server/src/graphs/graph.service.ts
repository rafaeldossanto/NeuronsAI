import { Inject, Injectable } from "@nestjs/common";
import { GRAPH_REPOSITORY, type GraphChanges, type GraphRepository } from "./graph-repository.js";
import {
  GRAPH_VERSION_REPOSITORY,
  type GraphVersionRepository,
} from "./graph-version-repository.js";
import { GraphVersionService } from "./graph-version.service.js";
import type { GraphRecord, GraphVersionRecord } from "./graph.records.js";
import {
  GraphHasVersionsError,
  GraphNotFoundError,
  GraphVersionNumberNotFoundError,
  InvalidGraphError,
} from "./graphs.errors.js";

export interface GraphWithLatest {
  graph: GraphRecord;
  /** Number of the latest published version; null while none was published. */
  latestVersion: number | null;
}

/** What the API does with graphs: draft management (CRUD) and publishing versions. */
@Injectable()
export class GraphService {
  constructor(
    @Inject(GRAPH_REPOSITORY) private readonly graphs: GraphRepository,
    @Inject(GRAPH_VERSION_REPOSITORY) private readonly versions: GraphVersionRepository,
    @Inject(GraphVersionService) private readonly publisher: GraphVersionService,
  ) {}

  create(input: { name: string; draft?: unknown }): Promise<GraphRecord> {
    return this.graphs.create(input);
  }

  list(): Promise<GraphRecord[]> {
    return this.graphs.list();
  }

  /** @throws GraphNotFoundError */
  async get(id: string): Promise<GraphWithLatest> {
    const graph = await this.require(id);
    const latest = await this.versions.findLatest(id);
    return { graph, latestVersion: latest?.version ?? null };
  }

  /** @throws GraphNotFoundError */
  async update(id: string, changes: GraphChanges): Promise<GraphWithLatest> {
    const graph = await this.graphs.update(id, changes);
    if (!graph) throw new GraphNotFoundError(id);
    const latest = await this.versions.findLatest(id);
    return { graph, latestVersion: latest?.version ?? null };
  }

  /** @throws GraphNotFoundError, GraphHasVersionsError */
  async remove(id: string): Promise<void> {
    await this.require(id);
    if (await this.versions.findLatest(id)) throw new GraphHasVersionsError(id);
    await this.graphs.delete(id);
  }

  /**
   * Validates and freezes a version. Without `definition` the saved draft is published.
   * @throws GraphNotFoundError, InvalidGraphError
   */
  async publish(graphId: string, definition?: unknown): Promise<GraphVersionRecord> {
    const graph = await this.require(graphId);
    const result = await this.publisher.publish(graphId, definition ?? graph.draft);
    if (!result.ok) throw new InvalidGraphError(result.issues);
    return result.version;
  }

  /** @throws GraphNotFoundError */
  async listVersions(graphId: string): Promise<GraphVersionRecord[]> {
    await this.require(graphId);
    return this.versions.listByGraph(graphId);
  }

  /** @throws GraphNotFoundError, GraphVersionNumberNotFoundError */
  async getVersion(graphId: string, version: number): Promise<GraphVersionRecord> {
    await this.require(graphId);
    const found = await this.versions.findByVersion(graphId, version);
    if (!found) throw new GraphVersionNumberNotFoundError(graphId, version);
    return found;
  }

  private async require(id: string): Promise<GraphRecord> {
    const graph = await this.graphs.findById(id);
    if (!graph) throw new GraphNotFoundError(id);
    return graph;
  }
}
