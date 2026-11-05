import { Inject, Injectable } from "@nestjs/common";
import { and, eq, lt, inArray } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { graphs, graphTriggers, webhookDeliveries } from "../database/schema/index.js";
import { resourceScope } from "../accounts/resource-scope.js";
import { GraphNotFoundError } from "../graphs/graphs.errors.js";
import type {
  TriggerOutcome,
  TriggerStatePatch,
  TriggerStateRecord,
  TriggerStateRepository,
} from "./trigger-state.js";

type Row = typeof graphTriggers.$inferSelect;

const toRecord = (row: Row, organizationId?: string | null): TriggerStateRecord => ({
  ...(organizationId && { organizationId }),
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
    const [owned] = await this.database.db
      .select({ id: graphs.id })
      .from(graphs)
      .where(and(eq(graphs.id, graphId), resourceScope.matches(graphs.organizationId)));
    if (!owned) throw new GraphNotFoundError(graphId);
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
      .select({ state: graphTriggers, organizationId: graphs.organizationId })
      .from(graphTriggers)
      .innerJoin(graphs, eq(graphs.id, graphTriggers.graphId))
      .where(
        and(
          eq(graphTriggers.graphId, graphId),
          eq(graphTriggers.triggerId, triggerId),
          resourceScope.matches(graphs.organizationId),
        ),
      );
    return row && toRecord(row.state, row.organizationId);
  }

  async findByHookId(hookId: string): Promise<TriggerStateRecord | undefined> {
    const [row] = await this.database.db
      .select({ state: graphTriggers, organizationId: graphs.organizationId })
      .from(graphTriggers)
      .innerJoin(graphs, eq(graphs.id, graphTriggers.graphId))
      .where(eq(graphTriggers.hookId, hookId));
    return row && toRecord(row.state, row.organizationId);
  }

  async update(graphId: string, triggerId: string, patch: TriggerStatePatch): Promise<void> {
    await this.database.db
      .update(graphTriggers)
      .set(patch)
      .where(
        and(
          eq(graphTriggers.graphId, graphId),
          eq(graphTriggers.triggerId, triggerId),
          inArray(
            graphTriggers.graphId,
            this.database.db
              .select({ id: graphs.id })
              .from(graphs)
              .where(resourceScope.matches(graphs.organizationId)),
          ),
        ),
      );
  }

  async listEnabled(): Promise<TriggerStateRecord[]> {
    const rows = await this.database.db
      .select({ state: graphTriggers, organizationId: graphs.organizationId })
      .from(graphTriggers)
      .innerJoin(graphs, eq(graphs.id, graphTriggers.graphId))
      .where(eq(graphTriggers.enabled, true));
    return rows.map((row) => toRecord(row.state, row.organizationId));
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
