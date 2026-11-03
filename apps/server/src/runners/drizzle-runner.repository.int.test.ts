import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rowsOf, startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { DrizzleRunnerRepository } from "./drizzle-runner.repository.js";
import { hashRunnerToken } from "./runner-token.js";
import { RunnerTokens } from "./runner-tokens.service.js";
import { RunnerNameTakenError } from "./runners.errors.js";

let testDb: TestDatabase;
let tokens: RunnerTokens;

beforeAll(async () => {
  testDb = await startTestDatabase();
  tokens = new RunnerTokens(new DrizzleRunnerRepository(testDb.database));
});

afterAll(async () => {
  await testDb.stop();
});

describe("runners table", () => {
  it("issues, recognizes and revokes a runner by the hash of its token", async () => {
    const issued = await tokens.issue("notebook");

    expect(await tokens.authenticate(issued.token)).toEqual({ id: issued.id, name: "notebook" });
    expect(await tokens.authenticate("nrn_desconhecido")).toBeUndefined();

    expect(await tokens.revoke("notebook")).toBe(true);
    expect(await tokens.authenticate(issued.token)).toBeUndefined();
    expect(await tokens.isActive(issued.id)).toBe(false);
    expect(await tokens.revoke("notebook")).toBe(false);
  });

  it("never stores the token itself", async () => {
    const issued = await tokens.issue("sem-token-no-banco");

    const stored = rowsOf<{ token_hash: string }>(
      await testDb.database.db.execute(
        sql`select token_hash from runners where name = 'sem-token-no-banco'`,
      ),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.token_hash).toBe(hashRunnerToken(issued.token));
    expect(stored[0]?.token_hash).not.toBe(issued.token);
    const listed = await tokens.list();
    expect(JSON.stringify(listed)).not.toContain(issued.token);
    expect(listed.find((runner) => runner.name === "sem-token-no-banco")).toMatchObject({
      revokedAt: null,
      lastSeenAt: null,
    });
  });

  it("refuses a second runner with the same name", async () => {
    await tokens.issue("duplicado");

    await expect(tokens.issue("duplicado")).rejects.toBeInstanceOf(RunnerNameTakenError);
  });

  it("records when the runner was last seen", async () => {
    const issued = await tokens.issue("visto");

    await tokens.markSeen(issued.id);

    const runner = (await tokens.list()).find((candidate) => candidate.id === issued.id);
    expect(runner?.lastSeenAt).toBeInstanceOf(Date);
  });
});
