import type { GraphDefinition } from "@neurons/graph-schema";
import type { GraphVersionRecord } from "./graph.records.js";

export interface GraphVersionRepository {
  /** Stores the definition as the next version of the graph; must be safe against concurrent callers. */
  appendNext(graphId: string, definition: GraphDefinition): Promise<GraphVersionRecord>;
  findById(versionId: string): Promise<GraphVersionRecord | undefined>;
  findLatest(graphId: string): Promise<GraphVersionRecord | undefined>;
  findByVersion(graphId: string, version: number): Promise<GraphVersionRecord | undefined>;
  /** Oldest first. */
  listByGraph(graphId: string): Promise<GraphVersionRecord[]>;
}

export const GRAPH_VERSION_REPOSITORY = Symbol("GRAPH_VERSION_REPOSITORY");
