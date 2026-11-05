import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { resourceScope } from "../accounts/resource-scope.js";
import { DatabaseService } from "../database/database.service.js";
import { graphs, graphTriggers, secrets } from "../database/schema/index.js";
import { webhookSecretName } from "../triggers/webhook-secret-name.js";
import type { GraphChanges, GraphRepository } from "./graph-repository.js";
import type { GraphRecord } from "./graph.records.js";

@Injectable()
export class DrizzleGraphRepository implements GraphRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async create(input: { name: string; draft?: unknown }): Promise<GraphRecord> {
    const [row] = await this.database.db
      .insert(graphs)
      .values({
        name: input.name,
        draft: input.draft ?? null,
        organizationId: resourceScope.current().organizationId,
      })
      .returning();
    return row as GraphRecord;
  }

  async findById(id: string): Promise<GraphRecord | undefined> {
    const [row] = await this.database.db
      .select()
      .from(graphs)
      .where(and(eq(graphs.id, id), resourceScope.matches(graphs.organizationId)));
    return row;
  }

  list(): Promise<GraphRecord[]> {
    return this.database.db
      .select()
      .from(graphs)
      .where(resourceScope.matches(graphs.organizationId))
      .orderBy(asc(graphs.createdAt));
  }

  async update(id: string, changes: GraphChanges): Promise<GraphRecord | undefined> {
    const [row] = await this.database.db
      .update(graphs)
      .set({
        // The creation time comes from the database clock (default now()); stamping the update
        // with the same clock keeps `updatedAt >= createdAt` whatever the host clock says (a
        // container's clock can differ from the host's by milliseconds).
        updatedAt: sql`now()`,
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.draft !== undefined && { draft: changes.draft }),
      })
      .where(and(eq(graphs.id, id), resourceScope.matches(graphs.organizationId)))
      .returning();
    return row;
  }

  /**
   * Deleting a graph takes its triggers with it (cascade), and with them the reason for their
   * webhook secrets to exist: those go in the same transaction, so none is left orphaned.
   */
  delete(id: string): Promise<boolean> {
    return this.database.db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: graphs.id })
        .from(graphs)
        .where(and(eq(graphs.id, id), resourceScope.matches(graphs.organizationId)));
      if (!owned) return false;
      const hooks = await tx
        .select({ hookId: graphTriggers.hookId })
        .from(graphTriggers)
        .where(eq(graphTriggers.graphId, id));
      if (hooks.length > 0) {
        await tx.delete(secrets).where(
          and(
            inArray(
              secrets.name,
              hooks.map((hook) => webhookSecretName(hook.hookId)),
            ),
            resourceScope.matches(secrets.organizationId),
          ),
        );
      }
      await tx.delete(graphs).where(eq(graphs.id, id));
      return true;
    });
  }
}
