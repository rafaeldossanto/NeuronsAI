import type { GraphDefinition } from "@neurons/graph-schema";
import type { RunStatus } from "../database/schema/index.js";
import type { Recorded, RunEventDraft } from "./run-event-draft.js";

export interface RunRecord {
  id: string;
  graphVersionId: string;
  status: RunStatus;
  /** Spending limit of the run; null means none. */
  budgetUsd: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** A run as the listings show it: with the graph its version belongs to. */
export interface RunSummaryRecord extends RunRecord {
  graphId: string;
}

/** A listed run with what its log says it consumed (same rules as `GET /runs/{id}`). */
export interface RunListItem extends RunSummaryRecord {
  graphName: string;
  /** The number of the version, as in `GET /graphs/{id}/versions`. */
  graphVersion: number;
  /** Sum of the turns whose cost is known; a lower bound when `unknownCostTurns` > 0. Never a guess. */
  costUsd: number;
  turns: number;
  unknownCostTurns: number;
}

export const RUN_SORTS = ["startedAt", "costUsd"] as const;
export type RunSort = (typeof RUN_SORTS)[number];

export interface RunListFilter {
  status?: RunStatus;
  graphId?: string;
  graphVersionId?: string;
  /** Bounds on the known cost, inclusive. Runs with unknown-cost turns are compared by their known part. */
  minCostUsd?: number;
  maxCostUsd?: number;
  /** Bounds on `startedAt`, inclusive; runs that never started never match when one is given. */
  from?: Date;
  to?: Date;
  /** Defaults to `startedAt`. */
  sort?: RunSort;
  /** Defaults to `desc` (newest / dearest first). */
  order?: "asc" | "desc";
  limit: number;
  /** Defaults to 0. */
  offset?: number;
}

/** One page of the listing and how many runs match the filter in all. */
export interface RunListPage {
  items: RunListItem[];
  total: number;
}

/** A run that is still going, with the graph it executes. */
export interface ActiveRun {
  organizationId?: string | null;
  run: RunRecord;
  graph: GraphDefinition;
}

export type FinalRunStatus = Extract<RunStatus, "succeeded" | "failed" | "cancelled">;

export interface RunRepository {
  /** Creates the run already `running` and stores the events in the same transaction. */
  createRunning(
    graphVersionId: string,
    eventsFor: (run: RunRecord) => RunEventDraft[],
    options?: { budgetUsd?: number },
  ): Promise<Recorded<RunRecord>>;

  /**
   * Moves a `running` run to its final status together with the events. Returns undefined when the
   * run was not running (already finished, or unknown), so only one caller ever finishes a run.
   */
  finish(
    runId: string,
    status: FinalRunStatus,
    events: RunEventDraft[],
  ): Promise<Recorded<RunRecord> | undefined>;

  findById(runId: string): Promise<RunRecord | undefined>;

  /** The run as the listings show it. */
  findSummary(runId: string): Promise<RunSummaryRecord | undefined>;

  listRunning(): Promise<ActiveRun[]>;

  /** Newest first unless the filter sorts otherwise; the cost comes aggregated from the event log. */
  list(filter: RunListFilter): Promise<RunListPage>;
}

export const RUN_REPOSITORY = Symbol("RUN_REPOSITORY");
