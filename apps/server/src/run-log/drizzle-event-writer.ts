import { eq, sql } from "drizzle-orm";
import type { DatabaseTransaction } from "../database/database.service.js";
import { runEvents, runs } from "../database/schema/index.js";
import { toRunEvent } from "../realtime/drizzle-run-event-history.js";
import type { RunEvent } from "../realtime/run-event.js";
import type { RunEventDraft } from "./run-event-draft.js";
import { RunNotFoundError } from "./run-log.errors.js";

/**
 * Reserves `count` consecutive seqs for the run and returns the first one. The single UPDATE takes
 * the run's row lock, so concurrent writers queue up and each gets its own range, with no gaps
 * (the range is committed or rolled back with the caller's transaction).
 */
export async function allocateSeqs(
  tx: DatabaseTransaction,
  runId: string,
  count: number,
): Promise<number> {
  const [row] = await tx
    .update(runs)
    .set({ lastSeq: sql`${runs.lastSeq} + ${count}` })
    .where(eq(runs.id, runId))
    .returning({ lastSeq: runs.lastSeq });
  if (!row) throw new RunNotFoundError(runId);
  return row.lastSeq - count + 1;
}

/** Inserts the drafts at `firstSeq`, `firstSeq + 1`, ... (the range must come from {@link allocateSeqs}). */
export async function insertEvents(
  tx: DatabaseTransaction,
  runId: string,
  firstSeq: number,
  drafts: RunEventDraft[],
): Promise<RunEvent[]> {
  if (drafts.length === 0) return [];
  const rows = await tx
    .insert(runEvents)
    .values(
      drafts.map((draft, index) => ({
        runId,
        seq: firstSeq + index,
        type: draft.type,
        agent: draft.agent ?? null,
        payload: draft.payload,
      })),
    )
    .returning();
  return rows.map(toRunEvent).sort((a, b) => a.seq - b.seq);
}

/** Allocates the seqs and inserts the drafts inside the caller's transaction. */
export async function appendEvents(
  tx: DatabaseTransaction,
  runId: string,
  drafts: RunEventDraft[],
): Promise<RunEvent[]> {
  if (drafts.length === 0) return [];
  const firstSeq = await allocateSeqs(tx, runId, drafts.length);
  return insertEvents(tx, runId, firstSeq, drafts);
}
