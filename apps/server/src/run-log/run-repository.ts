import type { GraphDefinition } from "@neurons/graph-schema";
import type { RunStatus } from "../database/schema/index.js";
import type { Recorded, RunEventDraft } from "./run-event-draft.js";

export interface RunRecord {
  id: string;
  graphVersionId: string;
  status: RunStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** A run that is still going, with the graph it executes. */
export interface ActiveRun {
  run: RunRecord;
  graph: GraphDefinition;
}

export type FinalRunStatus = Extract<RunStatus, "succeeded" | "failed" | "cancelled">;

export interface RunRepository {
  /** Creates the run already `running` and stores the events in the same transaction. */
  createRunning(
    graphVersionId: string,
    eventsFor: (run: RunRecord) => RunEventDraft[],
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

  listRunning(): Promise<ActiveRun[]>;
}

export const RUN_REPOSITORY = Symbol("RUN_REPOSITORY");
