import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { graphs } from "../database/schema/index.js";
import type { GraphChanges, GraphRepository } from "./graph-repository.js";
import type { GraphRecord } from "./graph.records.js";

@Injectable()
export class DrizzleGraphRepository implements GraphRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async create(input: { name: string; draft?: unknown }): Promise<GraphRecord> {
    const [row] = await this.database.db
      .insert(graphs)
      .values({ name: input.name, draft: input.draft ?? null })
      .returning();
    return row as GraphRecord;
  }

  async findById(id: string): Promise<GraphRecord | undefined> {
    const [row] = await this.database.db.select().from(graphs).where(eq(graphs.id, id));
    return row;
  }

  list(): Promise<GraphRecord[]> {
    return this.database.db.select().from(graphs).orderBy(asc(graphs.createdAt));
  }

  async update(id: string, changes: GraphChanges): Promise<GraphRecord | undefined> {
    const [row] = await this.database.db
      .update(graphs)
      .set({
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.draft !== undefined && { draft: changes.draft }),
      })
      .where(eq(graphs.id, id))
      .returning();
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.database.db
      .delete(graphs)
      .where(eq(graphs.id, id))
      .returning({ id: graphs.id });
    return deleted.length > 0;
  }
}
