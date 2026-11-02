import type { GraphRecord } from "./graph.records.js";

export interface GraphChanges {
  name?: string;
  /** The work in progress; null clears it. */
  draft?: unknown;
}

export interface GraphRepository {
  create(input: { name: string; draft?: unknown }): Promise<GraphRecord>;
  findById(id: string): Promise<GraphRecord | undefined>;
  list(): Promise<GraphRecord[]>;
  /** Changes what is given (`updatedAt` moves). Returns undefined when the graph does not exist. */
  update(id: string, changes: GraphChanges): Promise<GraphRecord | undefined>;
  /** Returns whether the graph existed. Fails while versions of it exist (they are immutable). */
  delete(id: string): Promise<boolean>;
}

export const GRAPH_REPOSITORY = Symbol("GRAPH_REPOSITORY");
