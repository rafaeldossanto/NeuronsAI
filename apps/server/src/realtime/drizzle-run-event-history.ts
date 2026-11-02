import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
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
}
