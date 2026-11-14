import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { USAGE_RECORDED, type UsageTotals } from "../guards/usage-totals.js";
import { runEvents } from "../database/schema/index.js";
import type { RunEventHistory } from "./run-event-history.js";
import type { RunEvent } from "./run-event.js";

export function toRunEvent(row: typeof runEvents.$inferSelect): RunEvent {
  return {
    runId: row.runId,
    seq: row.seq,
    type: row.type,
    agent: row.agent,
    payload: row.payload,
    at: row.at,
  };
}

/** Replays a run's log from `run_events`. */
@Injectable()
export class DrizzleRunEventHistory implements RunEventHistory {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async readFrom(runId: string, fromSeq: number, limit?: number): Promise<RunEvent[]> {
    const query = this.database.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gte(runEvents.seq, fromSeq)))
      .orderBy(asc(runEvents.seq));
    const rows = await (limit === undefined ? query : query.limit(limit));
    return rows.map(toRunEvent);
  }

  async readByType(runId: string, type: string): Promise<RunEvent[]> {
    const rows = await this.database.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.type, type)))
      .orderBy(asc(runEvents.seq));
    return rows.map(toRunEvent);
  }

  async usageByAgent(runId: string): Promise<Record<string, UsageTotals>> {
    // A turn counts as known only when its `costUsd` is a JSON number; null/absent is "unknown".
    const isKnown = sql`jsonb_typeof(${runEvents.payload} -> 'costUsd') = 'number'`;
    const rows = await this.database.db
      .select({
        agent: runEvents.agent,
        costUsd: sql<string>`coalesce(sum((${runEvents.payload} ->> 'costUsd')::numeric) filter (where ${isKnown}), 0)`,
        turns: sql<number>`count(*)::int`,
        unknown: sql<number>`(count(*) filter (where not ${isKnown}))::int`,
      })
      .from(runEvents)
      .where(
        and(
          eq(runEvents.runId, runId),
          eq(runEvents.type, USAGE_RECORDED),
          sql`${runEvents.agent} is not null`,
        ),
      )
      .groupBy(runEvents.agent);
    const totals: Record<string, UsageTotals> = {};
    for (const row of rows)
      totals[row.agent!] = {
        costUsd: Number(row.costUsd),
        turns: Number(row.turns),
        unknownCostTurns: Number(row.unknown),
      };
    return totals;
  }
}
