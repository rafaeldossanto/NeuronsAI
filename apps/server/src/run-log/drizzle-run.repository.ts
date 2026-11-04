import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { graphVersions, graphs, runEvents, runs } from "../database/schema/index.js";
import { appendEvents } from "./drizzle-event-writer.js";
import type { Recorded, RunEventDraft } from "./run-event-draft.js";
import type {
  ActiveRun,
  FinalRunStatus,
  RunListFilter,
  RunListItem,
  RunListPage,
  RunRecord,
  RunRepository,
  RunSummaryRecord,
} from "./run-repository.js";

const toRunRecord = (row: typeof runs.$inferSelect): RunRecord => ({
  id: row.id,
  graphVersionId: row.graphVersionId,
  status: row.status,
  budgetUsd: row.budgetUsd === null ? null : Number(row.budgetUsd),
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
});

@Injectable()
export class DrizzleRunRepository implements RunRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  createRunning(
    graphVersionId: string,
    eventsFor: (run: RunRecord) => RunEventDraft[],
    options: { budgetUsd?: number } = {},
  ): Promise<Recorded<RunRecord>> {
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(runs)
        .values({
          graphVersionId,
          status: "running",
          startedAt: new Date(),
          ...(options.budgetUsd !== undefined && { budgetUsd: String(options.budgetUsd) }),
        })
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

  async findSummary(runId: string): Promise<RunSummaryRecord | undefined> {
    const [row] = await this.database.db
      .select({ run: runs, graphId: graphVersions.graphId })
      .from(runs)
      .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
      .where(eq(runs.id, runId));
    return row && { ...toRunRecord(row.run), graphId: row.graphId };
  }

  async list(filter: RunListFilter): Promise<RunListPage> {
    const { db } = this.database;
    // One aggregate over the usage events of all runs, joined once: no query per run. A turn counts
    // as known only when its `costUsd` is a JSON number; null/absent is "unknown", never zero.
    const isKnown = sql`jsonb_typeof(${runEvents.payload} -> 'costUsd') = 'number'`;
    const usage = db
      .select({
        runId: runEvents.runId,
        known:
          sql<string>`coalesce(sum((${runEvents.payload} ->> 'costUsd')::numeric) filter (where ${isKnown}), 0)`.as(
            "known_cost",
          ),
        turns: sql<number>`count(*)::int`.as("usage_turns"),
        unknown: sql<number>`(count(*) filter (where not ${isKnown}))::int`.as("unknown_turns"),
      })
      .from(runEvents)
      .where(and(eq(runEvents.type, "UsageRecorded"), sql`${runEvents.agent} is not null`))
      .groupBy(runEvents.runId)
      .as("usage");
    const cost = sql<string>`coalesce(${usage.known}, 0)`;

    const conditions: SQL[] = [];
    if (filter.status) conditions.push(eq(runs.status, filter.status));
    if (filter.graphId) conditions.push(eq(graphVersions.graphId, filter.graphId));
    if (filter.graphVersionId) conditions.push(eq(runs.graphVersionId, filter.graphVersionId));
    if (filter.from) conditions.push(gte(runs.startedAt, filter.from));
    if (filter.to) conditions.push(lte(runs.startedAt, filter.to));
    if (filter.minCostUsd !== undefined)
      conditions.push(sql`${cost} >= ${String(filter.minCostUsd)}::numeric`);
    if (filter.maxCostUsd !== undefined)
      conditions.push(sql`${cost} <= ${String(filter.maxCostUsd)}::numeric`);
    const where = and(...conditions);

    const direction = filter.order === "asc" ? asc : desc;
    const startedAt =
      filter.order === "asc"
        ? sql`${runs.startedAt} asc nulls first`
        : sql`${runs.startedAt} desc nulls last`;
    const orderBy =
      filter.sort === "costUsd"
        ? [direction(cost), startedAt, direction(runs.id)]
        : [startedAt, direction(runs.id)];

    const [rows, [counted]] = await Promise.all([
      db
        .select({
          run: runs,
          graphId: graphVersions.graphId,
          graphName: graphs.name,
          graphVersion: graphVersions.version,
          cost,
          turns: usage.turns,
          unknown: usage.unknown,
        })
        .from(runs)
        .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
        .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
        .leftJoin(usage, eq(usage.runId, runs.id))
        .where(where)
        .orderBy(...orderBy)
        .limit(filter.limit)
        .offset(filter.offset ?? 0),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(runs)
        .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
        .leftJoin(usage, eq(usage.runId, runs.id))
        .where(where),
    ]);
    const items: RunListItem[] = rows.map((row) => ({
      ...toRunRecord(row.run),
      graphId: row.graphId,
      graphName: row.graphName,
      graphVersion: row.graphVersion,
      costUsd: Number(row.cost),
      turns: Number(row.turns ?? 0),
      unknownCostTurns: Number(row.unknown ?? 0),
    }));
    return { items, total: Number(counted?.total ?? 0) };
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
