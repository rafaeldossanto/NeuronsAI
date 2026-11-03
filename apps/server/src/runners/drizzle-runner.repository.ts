import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, and, isNull } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { runners } from "../database/schema/index.js";
import type { RunnerRecord, RunnerRepository } from "./runner-repository.js";
import { RunnerNameTakenError } from "./runners.errors.js";

const columns = {
  id: runners.id,
  name: runners.name,
  createdAt: runners.createdAt,
  lastSeenAt: runners.lastSeenAt,
  revokedAt: runners.revokedAt,
};

@Injectable()
export class DrizzleRunnerRepository implements RunnerRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async create(input: { name: string; tokenHash: string }): Promise<RunnerRecord> {
    const existing = await this.database.db
      .select({ id: runners.id })
      .from(runners)
      .where(eq(runners.name, input.name));
    if (existing.length > 0) throw new RunnerNameTakenError(input.name);

    const [row] = await this.database.db.insert(runners).values(input).returning(columns);
    return row!;
  }

  async findByTokenHash(tokenHash: string): Promise<RunnerRecord | undefined> {
    const [row] = await this.database.db
      .select(columns)
      .from(runners)
      .where(eq(runners.tokenHash, tokenHash));
    return row;
  }

  async findById(id: string): Promise<RunnerRecord | undefined> {
    const [row] = await this.database.db.select(columns).from(runners).where(eq(runners.id, id));
    return row;
  }

  async revokeByName(name: string): Promise<boolean> {
    const revoked = await this.database.db
      .update(runners)
      .set({ revokedAt: new Date() })
      .where(and(eq(runners.name, name), isNull(runners.revokedAt)))
      .returning({ id: runners.id });
    return revoked.length > 0;
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.database.db.update(runners).set({ lastSeenAt: at }).where(eq(runners.id, id));
  }

  list(): Promise<RunnerRecord[]> {
    return this.database.db.select(columns).from(runners).orderBy(asc(runners.createdAt));
  }
}
