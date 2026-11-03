import { randomUUID } from "node:crypto";
import type { RunnerRecord, RunnerRepository } from "../runner-repository.js";
import { RunnerNameTakenError } from "../runners.errors.js";

/** {@link RunnerRepository} for tests that do not need a database. */
export class InMemoryRunnerRepository implements RunnerRepository {
  private readonly rows = new Map<string, RunnerRecord & { tokenHash: string }>();

  create(input: { name: string; tokenHash: string }): Promise<RunnerRecord> {
    if ([...this.rows.values()].some((row) => row.name === input.name)) {
      return Promise.reject(new RunnerNameTakenError(input.name));
    }
    const row = {
      id: randomUUID(),
      name: input.name,
      tokenHash: input.tokenHash,
      createdAt: new Date(),
      lastSeenAt: null,
      revokedAt: null,
    };
    this.rows.set(row.id, row);
    return Promise.resolve(publicPart(row));
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
    const row = [...this.rows.values()].find((candidate) => candidate.name === name);
    if (!row || row.revokedAt) return Promise.resolve(false);
    row.revokedAt = new Date();
    return Promise.resolve(true);
  }

  touch(id: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.lastSeenAt = at;
    return Promise.resolve();
  }

  list(): Promise<RunnerRecord[]> {
    return Promise.resolve([...this.rows.values()].map(publicPart));
  }
}

const publicPart = (row: RunnerRecord): RunnerRecord => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt,
  lastSeenAt: row.lastSeenAt,
  revokedAt: row.revokedAt,
});
