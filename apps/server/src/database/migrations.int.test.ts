import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { graphs, graphVersions, messages, runEvents, runs } from "./schema/index.js";
import { rowsOf, startTestDatabase, type TestDatabase } from "./testing/test-database.js";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestDatabase();
});

afterAll(async () => {
  await testDb.stop();
});

const db = () => testDb.database.db;

/** Inserts the graph -> version -> run chain every other table hangs from. */
async function seedRun() {
  const [graph] = await db().insert(graphs).values({ name: "g" }).returning();
  const [version] = await db()
    .insert(graphVersions)
    .values({ graphId: graph!.id, version: 1, definition: {} as never })
    .returning();
  const [run] = await db().insert(runs).values({ graphVersionId: version!.id }).returning();
  return { graph: graph!, version: version!, run: run! };
}

describe("migrations", () => {
  it("create every table", async () => {
    const result = await db().execute(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );

    const tables = rowsOf<{ table_name: string }>(result).map((row) => row.table_name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "graphs",
        "graph_versions",
        "runs",
        "messages",
        "run_events",
        "secrets",
      ]),
    );
  });

  it("can be applied again without effect", async () => {
    await expect(testDb.migrate()).resolves.toBeUndefined();
  });

  it("create the inbox index on messages (run_id, to_agent, acked_at)", async () => {
    const result = await db().execute(
      sql`select indexdef from pg_indexes where indexname = 'messages_inbox_idx'`,
    );

    expect(rowsOf<{ indexdef: string }>(result)[0]?.indexdef).toContain(
      "(run_id, to_agent, acked_at)",
    );
  });
});

describe("schema rules", () => {
  it("applies defaults to a new run", async () => {
    const { run } = await seedRun();

    expect(run).toMatchObject({ status: "pending", budgetUsd: null, spentUsd: "0.000000" });
  });

  it("rejects an unknown run status", async () => {
    const { version } = await seedRun();

    await expect(
      db()
        .insert(runs)
        .values({ graphVersionId: version.id, status: "weird" as never }),
    ).rejects.toThrow();
  });

  it("rejects an unknown message kind and accepts the three valid ones", async () => {
    const { run } = await seedRun();
    const base = { runId: run.id, fromAgent: "a", toAgent: "b", body: "oi" };

    for (const [index, kind] of (["message", "ask", "reply"] as const).entries()) {
      await db()
        .insert(messages)
        .values({ ...base, seq: index + 1, kind });
    }
    await expect(
      db()
        .insert(messages)
        .values({ ...base, seq: 4, kind: "shout" as never }),
    ).rejects.toThrow();
  });

  it("links a reply to the message it answers", async () => {
    const { run } = await seedRun();
    const base = { runId: run.id, fromAgent: "a", toAgent: "b", body: "oi" };
    const [ask] = await db()
      .insert(messages)
      .values({ ...base, seq: 1, kind: "ask" })
      .returning();

    const [reply] = await db()
      .insert(messages)
      .values({ ...base, seq: 2, kind: "reply", replyTo: ask!.id })
      .returning();

    expect(reply?.replyTo).toBe(ask?.id);
  });

  it("keeps seq unique per run in messages", async () => {
    const { run } = await seedRun();
    const message = {
      runId: run.id,
      seq: 1,
      fromAgent: "a",
      toAgent: "b",
      body: "oi",
      kind: "message",
    } as const;
    await db().insert(messages).values(message);

    await expect(db().insert(messages).values(message)).rejects.toThrow();
  });

  it("starts a run with no event seq handed out", async () => {
    const { run } = await seedRun();

    expect(run.lastSeq).toBe(0);
  });

  it("keeps seq unique per run in run_events", async () => {
    const { run } = await seedRun();
    const event = { runId: run.id, seq: 1, type: "run.started", payload: {} };
    await db().insert(runEvents).values(event);

    await expect(db().insert(runEvents).values(event)).rejects.toThrow();
    await expect(
      db()
        .insert(runEvents)
        .values({ ...event, seq: 2 }),
    ).resolves.toBeDefined();
  });

  it("refuses to delete a graph version that has runs", async () => {
    const { version } = await seedRun();

    await expect(
      db()
        .delete(graphVersions)
        .where(sql`id = ${version.id}`),
    ).rejects.toThrow();
  });
});

/** Drizzle wraps the Postgres error as the `cause` of its "Failed query" error. */
function isAppendOnlyViolation(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return cause instanceof Error && /is append-only/.test(cause.message);
}

describe("immutability triggers", () => {
  it("reject updates to graph_versions", async () => {
    const { version } = await seedRun();

    await expect(
      db()
        .update(graphVersions)
        .set({ definition: { changed: true } as never })
        .where(sql`id = ${version.id}`),
    ).rejects.toSatisfy(isAppendOnlyViolation);
  });

  it("reject updates to run_events but allow appending", async () => {
    const { run } = await seedRun();
    await db().insert(runEvents).values({ runId: run.id, seq: 1, type: "a", payload: {} });

    await expect(
      db()
        .update(runEvents)
        .set({ type: "b" })
        .where(sql`run_id = ${run.id}`),
    ).rejects.toSatisfy(isAppendOnlyViolation);
    await expect(
      db().insert(runEvents).values({ runId: run.id, seq: 2, type: "b", payload: {} }),
    ).resolves.toBeDefined();
  });
});
