import { Inject, Injectable } from "@nestjs/common";
import { and, eq, lt } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { graphTriggers, webhookDeliveries } from "../database/schema/index.js";
import type {
  TriggerOutcome,
  TriggerStatePatch,
  TriggerStateRecord,
  TriggerStateRepository,
} from "./trigger-state.js";

type Row = typeof graphTriggers.$inferSelect;

const toRecord = (row: Row): TriggerStateRecord => ({
  graphId: row.graphId,
  triggerId: row.triggerId,
  hookId: row.hookId,
  enabled: row.enabled,
  secretSetAt: row.secretSetAt,
  lastFiredAt: row.lastFiredAt,
  lastOutcome: row.lastOutcome as TriggerOutcome | null,
  lastNote: row.lastNote,
  lastRunId: row.lastRunId,
  nextRunAt: row.nextRunAt,
});

@Injectable()
export class DrizzleTriggerStateRepository implements TriggerStateRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async ensure(graphId: string, triggerId: string, hookId: string): Promise<TriggerStateRecord> {
    await this.database.db
      .insert(graphTriggers)
      .values({ graphId, triggerId, hookId })
      .onConflictDoNothing({ target: [graphTriggers.graphId, graphTriggers.triggerId] });
    const record = await this.find(graphId, triggerId);
    if (!record) throw new Error("O estado do gatilho não foi criado.");
    return record;
  }

  async find(graphId: string, triggerId: string): Promise<TriggerStateRecord | undefined> {
    const [row] = await this.database.db
      .select()
      .from(graphTriggers)
      .where(and(eq(graphTriggers.graphId, graphId), eq(graphTriggers.triggerId, triggerId)));
    return row && toRecord(row);
  }

  async findByHookId(hookId: string): Promise<TriggerStateRecord | undefined> {
    const [row] = await this.database.db
      .select()
      .from(graphTriggers)
      .where(eq(graphTriggers.hookId, hookId));
    return row && toRecord(row);
  }

  async update(graphId: string, triggerId: string, patch: TriggerStatePatch): Promise<void> {
    await this.database.db
      .update(graphTriggers)
      .set(patch)
      .where(and(eq(graphTriggers.graphId, graphId), eq(graphTriggers.triggerId, triggerId)));
  }

  async listEnabled(): Promise<TriggerStateRecord[]> {
    const rows = await this.database.db
      .select()
      .from(graphTriggers)
      .where(eq(graphTriggers.enabled, true));
    return rows.map(toRecord);
  }

  async recordDelivery(hookId: string, signature: string, receivedAt: Date): Promise<boolean> {
    const inserted = await this.database.db
      .insert(webhookDeliveries)
      .values({ hookId, signature, receivedAt })
      .onConflictDoNothing()
      .returning({ hookId: webhookDeliveries.hookId });
    return inserted.length > 0;
  }

  async purgeDeliveries(receivedBefore: Date): Promise<void> {
    await this.database.db
      .delete(webhookDeliveries)
      .where(lt(webhookDeliveries.receivedAt, receivedBefore));
  }
}
