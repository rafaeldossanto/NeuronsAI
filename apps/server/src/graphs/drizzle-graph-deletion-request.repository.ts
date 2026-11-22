import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { resourceScope } from "../accounts/resource-scope.js";
import { DatabaseService } from "../database/database.service.js";
import { graphDeletionRequests, graphs, users } from "../database/schema/index.js";
import type {
  GraphDeletionRequestRecord,
  GraphDeletionRequestRepository,
} from "./graph-deletion-request-repository.js";

/** Every query goes through `graphs`, so a request only exists for the caller's own organization. */
@Injectable()
export class DrizzleGraphDeletionRequestRepository implements GraphDeletionRequestRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async create(
    graphId: string,
    requestedBy: string,
  ): Promise<GraphDeletionRequestRecord | undefined> {
    const [graph] = await this.database.db
      .select({ organizationId: graphs.organizationId })
      .from(graphs)
      .where(and(eq(graphs.id, graphId), resourceScope.matches(graphs.organizationId)));
    if (!graph) return undefined;
    // The partial unique index (one pending per graph) makes a second request insert nothing.
    const [inserted] = await this.database.db
      .insert(graphDeletionRequests)
      .values({ graphId, organizationId: graph.organizationId, requestedBy })
      .onConflictDoNothing()
      .returning({ id: graphDeletionRequests.id });
    return inserted ? this.findPending(graphId) : undefined;
  }

  async findPending(graphId: string): Promise<GraphDeletionRequestRecord | undefined> {
    return (await this.pending(eq(graphDeletionRequests.graphId, graphId)))[0];
  }

  listPending(): Promise<GraphDeletionRequestRecord[]> {
    return this.pending();
  }

  async cancel(graphId: string, userId: string): Promise<boolean> {
    return this.decide(graphId, "cancelled", userId, userId);
  }

  async reject(graphId: string, decidedBy: string | null): Promise<boolean> {
    return this.decide(graphId, "rejected", decidedBy);
  }

  private async decide(
    graphId: string,
    status: "cancelled" | "rejected",
    decidedBy: string | null,
    onlyRequestedBy?: string,
  ): Promise<boolean> {
    const rows = await this.database.db
      .update(graphDeletionRequests)
      .set({ status, decidedBy, decidedAt: new Date() })
      .where(
        and(
          eq(graphDeletionRequests.graphId, graphId),
          eq(graphDeletionRequests.status, "pending"),
          ...(onlyRequestedBy ? [eq(graphDeletionRequests.requestedBy, onlyRequestedBy)] : []),
          inArray(
            graphDeletionRequests.graphId,
            this.database.db
              .select({ id: graphs.id })
              .from(graphs)
              .where(resourceScope.matches(graphs.organizationId)),
          ),
        ),
      )
      .returning({ id: graphDeletionRequests.id });
    return rows.length > 0;
  }

  private pending(extra?: ReturnType<typeof eq>): Promise<GraphDeletionRequestRecord[]> {
    return this.database.db
      .select({
        id: graphDeletionRequests.id,
        graphId: graphDeletionRequests.graphId,
        requestedBy: graphDeletionRequests.requestedBy,
        requesterName: users.displayName,
        createdAt: graphDeletionRequests.createdAt,
      })
      .from(graphDeletionRequests)
      .innerJoin(graphs, eq(graphs.id, graphDeletionRequests.graphId))
      .innerJoin(users, eq(users.id, graphDeletionRequests.requestedBy))
      .where(
        and(
          eq(graphDeletionRequests.status, "pending"),
          resourceScope.matches(graphs.organizationId),
          extra,
        ),
      );
  }
}
