import { Inject, Injectable } from "@nestjs/common";
import type { GraphDefinition } from "@neurons/graph-schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { graphs, graphVersions } from "../database/schema/index.js";
import type { GraphVersionRepository } from "./graph-version-repository.js";
import type { GraphVersionRecord } from "./graph.records.js";
import { resourceScope } from "../accounts/resource-scope.js";
import { GraphNotFoundError } from "./graphs.errors.js";

@Injectable()
export class DrizzleGraphVersionRepository implements GraphVersionRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /**
   * Locks the graph row so concurrent publishers of the same graph take turns; the number is then
   * computed in the INSERT itself. The unique (graph_id, version) constraint remains the safety net.
   */
  appendNext(graphId: string, definition: GraphDefinition): Promise<GraphVersionRecord> {
    return this.database.db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: graphs.id })
        .from(graphs)
        .where(and(eq(graphs.id, graphId), resourceScope.matches(graphs.organizationId)))
        .for("update");
      if (!owned) throw new GraphNotFoundError(graphId);
      const [row] = await tx
        .insert(graphVersions)
        .values({
          graphId,
          definition,
          version: sql`(select coalesce(max(${graphVersions.version}), 0) + 1 from ${graphVersions} where ${graphVersions.graphId} = ${graphId})`,
        })
        .returning();
      return row as GraphVersionRecord;
    });
  }

  async findById(versionId: string): Promise<GraphVersionRecord | undefined> {
    const [row] = await this.database.db
      .select({ version: graphVersions })
      .from(graphVersions)
      .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
      .where(and(eq(graphVersions.id, versionId), resourceScope.matches(graphs.organizationId)));
    return row?.version;
  }

  async findLatest(graphId: string): Promise<GraphVersionRecord | undefined> {
    const [row] = await this.database.db
      .select({ version: graphVersions })
      .from(graphVersions)
      .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
      .where(and(eq(graphVersions.graphId, graphId), resourceScope.matches(graphs.organizationId)))
      .orderBy(desc(graphVersions.version))
      .limit(1);
    return row?.version;
  }

  async findByVersion(graphId: string, version: number): Promise<GraphVersionRecord | undefined> {
    const [row] = await this.database.db
      .select({ version: graphVersions })
      .from(graphVersions)
      .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
      .where(
        and(
          eq(graphVersions.graphId, graphId),
          eq(graphVersions.version, version),
          resourceScope.matches(graphs.organizationId),
        ),
      );
    return row?.version;
  }

  async listByGraph(graphId: string): Promise<GraphVersionRecord[]> {
    const rows = await this.database.db
      .select({ version: graphVersions })
      .from(graphVersions)
      .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
      .where(and(eq(graphVersions.graphId, graphId), resourceScope.matches(graphs.organizationId)))
      .orderBy(asc(graphVersions.version));
    return rows.map((row) => row.version);
  }
}
