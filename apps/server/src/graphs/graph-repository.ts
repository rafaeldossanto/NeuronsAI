import type { GraphAccessMode } from "../database/schema/index.js";
import type { GraphRecord } from "./graph.records.js";

/** What a new graph is made of; the owner and the mode only exist for a signed-in person. */
export interface NewGraph {
  name: string;
  draft?: unknown;
  ownerUserId?: string;
  accessMode?: GraphAccessMode;
}

export interface GraphChanges {
  name?: string;
  /** The work in progress; null clears it. */
  draft?: unknown;
}

export interface GraphRepository {
  create(input: NewGraph): Promise<GraphRecord>;
  findById(id: string): Promise<GraphRecord | undefined>;
  list(): Promise<GraphRecord[]>;
  /** Changes what is given (`updatedAt` moves). Returns undefined when the graph does not exist. */
  update(id: string, changes: GraphChanges): Promise<GraphRecord | undefined>;
  /** Whether a run of any version of the graph is still pending or running. */
  hasActiveRuns(id: string): Promise<boolean>;
  /**
   * Deletes the graph with everything that hangs from it, in one transaction: its runs (and their
   * messages and events), its versions, its triggers and the webhook secrets of those triggers.
   * Returns whether the graph existed.
   * @throws GraphHasActiveRunsError when a run is still pending or running (nothing is deleted)
   */
  delete(id: string): Promise<boolean>;
}

export const GRAPH_REPOSITORY = Symbol("GRAPH_REPOSITORY");
