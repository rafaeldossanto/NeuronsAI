import { randomUUID } from "node:crypto";
import { resourceScope } from "../../accounts/resource-scope.js";
import type { RunnerRecord, RunnerRepository } from "../runner-repository.js";
import { RunnerNameTakenError } from "../runners.errors.js";

type Row = RunnerRecord & { tokenHash: string };

/** {@link RunnerRepository} for tests that do not need a database. */
export class InMemoryRunnerRepository implements RunnerRepository {
  private readonly rows = new Map<string, Row>();

  create(input: { name: string; tokenHash: string }): Promise<RunnerRecord> {
    if (this.inScope().some((row) => !row.ownerUserId && row.name === input.name)) {
      return Promise.reject(new RunnerNameTakenError(input.name));
    }
    return Promise.resolve(publicPart(this.insert(input)));
  }

  upsertPersonal(input: {
    ownerUserId: string;
    name: string;
    tokenHash: string;
  }): Promise<RunnerRecord> {
    const existing = this.inScope().find(
      (row) => row.ownerUserId === input.ownerUserId && row.name === input.name,
    );
    if (existing) {
      existing.tokenHash = input.tokenHash;
      existing.revokedAt = null;
      return Promise.resolve(publicPart(existing));
    }
    return Promise.resolve(publicPart(this.insert(input)));
  }

  findByTokenHash(tokenHash: string): Promise<RunnerRecord | undefined> {
    const row = [...this.rows.values()].find((candidate) => candidate.tokenHash === tokenHash);
    return Promise.resolve(row && publicPart(row));
  }

  findById(id: string): Promise<RunnerRecord | undefined> {
    const row = this.rows.get(id);
    return Promise.resolve(row && publicPart(row));
  }

  revokeByName(name: string): Promise<boolean> {
    const row = this.inScope().find(
      (candidate) => !candidate.ownerUserId && candidate.name === name,
    );
    if (!row || row.revokedAt) return Promise.resolve(false);
    row.revokedAt = new Date();
    return Promise.resolve(true);
  }

  revokePersonal(id: string, ownerUserId: string): Promise<boolean> {
    const row = this.inScope().find(
      (candidate) => candidate.id === id && candidate.ownerUserId === ownerUserId,
    );
    if (!row) return Promise.resolve(false);
    row.revokedAt ??= new Date();
    return Promise.resolve(true);
  }

  touch(id: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.lastSeenAt = at;
    return Promise.resolve();
  }

  list(): Promise<RunnerRecord[]> {
    return Promise.resolve(
      this.inScope()
        .filter((row) => !row.ownerUserId)
        .map(publicPart),
    );
  }

  listPersonal(ownerUserId: string): Promise<RunnerRecord[]> {
    return Promise.resolve(
      this.inScope()
        .filter((row) => row.ownerUserId === ownerUserId)
        .map(publicPart),
    );
  }

  private insert(input: { name: string; tokenHash: string; ownerUserId?: string }): Row {
    const row: Row = {
      id: randomUUID(),
      organizationId: resourceScope.current().organizationId,
      ...(input.ownerUserId && { ownerUserId: input.ownerUserId }),
      name: input.name,
      tokenHash: input.tokenHash,
      createdAt: new Date(),
      lastSeenAt: null,
      revokedAt: null,
    };
    this.rows.set(row.id, row);
    return row;
  }

  private inScope(): Row[] {
    const organizationId = resourceScope.current().organizationId;
    return [...this.rows.values()].filter((row) => (row.organizationId ?? null) === organizationId);
  }
}

const publicPart = (row: Row): RunnerRecord => ({
  id: row.id,
  organizationId: row.organizationId ?? null,
  ownerUserId: row.ownerUserId ?? null,
  name: row.name,
  createdAt: row.createdAt,
  lastSeenAt: row.lastSeenAt,
  revokedAt: row.revokedAt,
});
