import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { graphVersions, runs } from "../database/schema/index.js";
import { appendEvents } from "./drizzle-event-writer.js";
import type { Recorded, RunEventDraft } from "./run-event-draft.js";
import type { ActiveRun, FinalRunStatus, RunRecord, RunRepository } from "./run-repository.js";

const toRunRecord = (row: typeof runs.$inferSelect): RunRecord => ({
  id: row.id,
  graphVersionId: row.graphVersionId,
  status: row.status,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
});

@Injectable()
export class DrizzleRunRepository implements RunRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  createRunning(
    graphVersionId: string,
    eventsFor: (run: RunRecord) => RunEventDraft[],
  ): Promise<Recorded<RunRecord>> {
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(runs)
        .values({ graphVersionId, status: "running", startedAt: new Date() })
        .returning();
      const record = toRunRecord(row!);
      return { record, events: await appendEvents(tx, record.id, eventsFor(record)) };
    });
  }

  finish(
    runId: string,
    status: FinalRunStatus,
    events: RunEventDraft[],
  ): Promise<Recorded<RunRecord> | undefined> {
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(runs)
        .set({ status, finishedAt: new Date() })
        .where(and(eq(runs.id, runId), eq(runs.status, "running")))
        .returning();
      if (!row) return undefined;
      return { record: toRunRecord(row), events: await appendEvents(tx, runId, events) };
    });
  }

  async findById(runId: string): Promise<RunRecord | undefined> {
    const [row] = await this.database.db.select().from(runs).where(eq(runs.id, runId));
    return row && toRunRecord(row);
  }

  async listRunning(): Promise<ActiveRun[]> {
    const rows = await this.database.db
      .select({ run: runs, definition: graphVersions.definition })
      .from(runs)
      .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
      .where(eq(runs.status, "running"))
      .orderBy(runs.id);
    return rows.map(({ run, definition }) => ({ run: toRunRecord(run), graph: definition }));
  }
}
