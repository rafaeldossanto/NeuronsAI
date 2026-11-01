import type { GraphRecord } from "./graph.records.js";

export interface GraphRepository {
  create(input: { name: string; draft?: unknown }): Promise<GraphRecord>;
  findById(id: string): Promise<GraphRecord | undefined>;
  list(): Promise<GraphRecord[]>;
  /** Returns undefined when the graph does not exist. */
  saveDraft(id: string, draft: unknown): Promise<GraphRecord | undefined>;
}

export const GRAPH_REPOSITORY = Symbol("GRAPH_REPOSITORY");
