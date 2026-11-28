import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, and, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { runners } from "../database/schema/index.js";
import type { RunnerRecord, RunnerRepository } from "./runner-repository.js";
import { RunnerNameTakenError } from "./runners.errors.js";
import { resourceScope } from "../accounts/resource-scope.js";

const columns = {
  organizationId: runners.organizationId,
  ownerUserId: runners.ownerUserId,
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
      .where(
        and(
          eq(runners.name, input.name),
          isNull(runners.ownerUserId),
          resourceScope.matches(runners.organizationId),
        ),
      );
    if (existing.length > 0) throw new RunnerNameTakenError(input.name);

    const [row] = await this.database.db
      .insert(runners)
      .values({ ...input, organizationId: resourceScope.current().organizationId })
      .returning(columns);
    return row!;
  }

  upsertPersonal(input: {
    ownerUserId: string;
    name: string;
    tokenHash: string;
  }): Promise<RunnerRecord> {
    return this.database.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: runners.id })
        .from(runners)
        .where(
          and(
            eq(runners.name, input.name),
            eq(runners.ownerUserId, input.ownerUserId),
            resourceScope.matches(runners.organizationId),
          ),
        );
      if (existing) {
        // Same record, new token: the old one stops working and a revoked runner comes back.
        const [row] = await tx
          .update(runners)
          .set({ tokenHash: input.tokenHash, revokedAt: null })
          .where(eq(runners.id, existing.id))
          .returning(columns);
        return row!;
      }
      const [row] = await tx
        .insert(runners)
        .values({ ...input, organizationId: resourceScope.current().organizationId })
        .returning(columns);
      return row!;
    });
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
      .where(
        and(
          eq(runners.name, name),
          isNull(runners.ownerUserId),
          isNull(runners.revokedAt),
          resourceScope.matches(runners.organizationId),
        ),
      )
      .returning({ id: runners.id });
    return revoked.length > 0;
  }

  async revokePersonal(id: string, ownerUserId: string): Promise<boolean> {
    const found = await this.database.db
      .update(runners)
      // Keeps the moment of the first revocation when it was already revoked.
      .set({ revokedAt: sql`coalesce(${runners.revokedAt}, now())` })
      .where(
        and(
          eq(runners.id, id),
          eq(runners.ownerUserId, ownerUserId),
          resourceScope.matches(runners.organizationId),
        ),
      )
      .returning({ id: runners.id });
    return found.length > 0;
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.database.db.update(runners).set({ lastSeenAt: at }).where(eq(runners.id, id));
  }

  list(): Promise<RunnerRecord[]> {
    return this.database.db
      .select(columns)
      .from(runners)
      .where(and(isNull(runners.ownerUserId), resourceScope.matches(runners.organizationId)))
      .orderBy(asc(runners.createdAt));
  }

  listPersonal(ownerUserId: string): Promise<RunnerRecord[]> {
    return this.database.db
      .select(columns)
      .from(runners)
      .where(
        and(eq(runners.ownerUserId, ownerUserId), resourceScope.matches(runners.organizationId)),
      )
      .orderBy(asc(runners.createdAt));
  }
}
