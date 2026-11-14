import twoAgents from "@neurons/graph-schema/examples/two-agents.json" with { type: "json" };
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runEvents, runs, type RunStatus } from "../database/schema/index.js";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { DrizzleGraphRepository } from "../graphs/drizzle-graph.repository.js";
import { DrizzleGraphVersionRepository } from "../graphs/drizzle-graph-version.repository.js";
import { GraphVersionService } from "../graphs/graph-version.service.js";
import { DrizzleRunRepository } from "./drizzle-run.repository.js";
import type { RunListFilter } from "./run-repository.js";

let testDb: TestDatabase;
let repository: DrizzleRunRepository;
let graphA: { graphId: string; v1: string; v2: string };
let graphB: { graphId: string; v1: string };
const id: Record<string, string> = {};

beforeAll(async () => {
  testDb = await startTestDatabase();
  repository = new DrizzleRunRepository(testDb.database);
  const graphs = new DrizzleGraphRepository(testDb.database);
  const versions = new GraphVersionService(
    graphs,
    new DrizzleGraphVersionRepository(testDb.database),
  );

  const publish = async (graphId: string) => {
    const result = await versions.publish(graphId, { ...twoAgents, id: graphId });
    if (!result.ok) throw new Error("grafo de exemplo inválido");
    return result.version.id;
  };
  const a = await graphs.create({ name: "Grafo A" });
  const b = await graphs.create({ name: "Grafo B" });
  graphA = { graphId: a.id, v1: await publish(a.id), v2: await publish(a.id) };
  graphB = { graphId: b.id, v1: await publish(b.id) };

  /** Seeds a run straight into the tables, with the usage turns given (`null` = unknown cost). */
  async function seed(
    key: string,
    version: string,
    status: RunStatus,
    startedAt: string | null,
    durationSeconds: number | null,
    turns: (number | null)[],
  ) {
    const started = startedAt ? new Date(startedAt) : null;
    const [row] = await testDb.database.db
      .insert(runs)
      .values({
        graphVersionId: version,
        status,
        startedAt: started,
        finishedAt:
          started && durationSeconds !== null
            ? new Date(started.getTime() + durationSeconds * 1000)
            : null,
        lastSeq: turns.length,
      })
      .returning();
    id[key] = row!.id;
    if (turns.length > 0) {
      await testDb.database.db.insert(runEvents).values(
        turns.map((costUsd, index) => ({
          runId: row!.id,
          seq: index + 1,
          type: "UsageRecorded",
          agent: "Pesquisador",
          payload: { costUsd, inputTokens: 10 },
        })),
      );
    }
  }

  await seed("a1", graphA.v1, "succeeded", "2026-11-01T10:00:00.000Z", 60, [0.1, 0.2]);
  await seed("a2", graphA.v1, "failed", "2026-11-02T10:00:00.000Z", 5, [0.5, null]);
  await seed("a3", graphA.v2, "succeeded", "2026-11-03T10:00:00.000Z", 120, [2]);
  await seed("a4", graphA.v2, "running", "2026-11-04T10:00:00.000Z", null, []);
  await seed("b1", graphB.v1, "cancelled", "2026-11-02T12:00:00.000Z", 1, [null]);
  await seed("b2", graphB.v1, "pending", null, null, []);
});

afterAll(async () => {
  await testDb.stop();
});

async function keys(filter: Partial<RunListFilter> = {}) {
  const { items, total } = await repository.list({ limit: 50, ...filter });
  const byId = Object.fromEntries(Object.entries(id).map(([key, value]) => [value, key]));
  return { keys: items.map((item) => byId[item.id]), total };
}

describe("DrizzleRunRepository.list", () => {
  it("is newest first by default, with the unstarted run last", async () => {
    expect((await keys()).keys).toEqual(["a4", "a3", "b1", "a2", "a1", "b2"]);
    expect((await keys({ order: "asc" })).keys).toEqual(["b2", "a1", "a2", "b1", "a3", "a4"]);
  });

  it("sums the known cost from the log and counts the unknown turns apart", async () => {
    const { items } = await repository.list({ limit: 50 });
    const of = (key: string) => items.find((item) => item.id === id[key])!;
    expect(of("a1")).toMatchObject({ turns: 2, unknownCostTurns: 0 });
    expect(of("a1").costUsd).toBeCloseTo(0.3, 6);
    expect(of("a2")).toMatchObject({ costUsd: 0.5, turns: 2, unknownCostTurns: 1 });
    expect(of("b1")).toMatchObject({ costUsd: 0, turns: 1, unknownCostTurns: 1 });
    expect(of("a4")).toMatchObject({ costUsd: 0, turns: 0, unknownCostTurns: 0 });
    expect(of("a3")).toMatchObject({ graphName: "Grafo A", graphVersion: 2 });
    expect(of("b1")).toMatchObject({ graphName: "Grafo B", graphVersion: 1 });
  });

  it("gives the same cost on a page as on the whole list, with and without the cost deciding", async () => {
    const whole = (await repository.list({ limit: 50 })).items;
    const page = await repository.list({ limit: 2, offset: 1 });
    expect(page.total).toBe(6);
    expect(page.items.map((item) => item.id)).toEqual(whole.slice(1, 3).map((item) => item.id));
    for (const item of page.items) {
      const same = whole.find((other) => other.id === item.id)!;
      expect([item.costUsd, item.turns, item.unknownCostTurns]).toEqual([
        same.costUsd,
        same.turns,
        same.unknownCostTurns,
      ]);
    }
    // Ordering by cost takes the other path (the totals join the whole list): same numbers.
    const byCost = await repository.list({ limit: 50, sort: "costUsd" });
    for (const item of byCost.items) {
      const same = whole.find((other) => other.id === item.id)!;
      expect([item.costUsd, item.turns, item.unknownCostTurns]).toEqual([
        same.costUsd,
        same.turns,
        same.unknownCostTurns,
      ]);
    }
  });

  it("filters by status, graph and version", async () => {
    expect((await keys({ status: "succeeded" })).keys).toEqual(["a3", "a1"]);
    expect((await keys({ graphId: graphB.graphId })).keys).toEqual(["b1", "b2"]);
    expect((await keys({ graphVersionId: graphA.v2 })).keys).toEqual(["a4", "a3"]);
    expect((await keys({ graphId: graphA.graphId, graphVersionId: graphB.v1 })).keys).toEqual([]);
  });

  it("filters by the known cost; runs with unknown turns count by their known part", async () => {
    expect((await keys({ minCostUsd: 0.3 })).keys).toEqual(["a3", "a2", "a1"]);
    expect((await keys({ minCostUsd: 0.5, maxCostUsd: 1 })).keys).toEqual(["a2"]);
    expect((await keys({ maxCostUsd: 0.1 })).keys).toEqual(["a4", "b1", "b2"]);
    expect((await keys({ maxCostUsd: 0.5, status: "failed" })).keys).toEqual(["a2"]);
  });

  it("filters by the start period, inclusive, and drops runs that never started", async () => {
    const from = new Date("2026-11-02T10:00:00.000Z");
    const to = new Date("2026-11-03T10:00:00.000Z");
    expect((await keys({ from, to })).keys).toEqual(["a3", "b1", "a2"]);
    expect((await keys({ from })).keys).not.toContain("b2");
    expect((await keys({ to: new Date("2026-11-01T23:00:00.000Z") })).keys).toEqual(["a1"]);
  });

  it("combines every filter", async () => {
    const found = await keys({
      graphId: graphA.graphId,
      graphVersionId: graphA.v1,
      status: "failed",
      minCostUsd: 0.4,
      from: new Date("2026-11-02T00:00:00.000Z"),
    });
    expect(found).toEqual({ keys: ["a2"], total: 1 });
  });

  it("sorts by cost and breaks ties by start", async () => {
    expect((await keys({ sort: "costUsd" })).keys).toEqual(["a3", "a2", "a1", "a4", "b1", "b2"]);
    expect((await keys({ sort: "costUsd", order: "asc" })).keys).toEqual([
      "b2",
      "b1",
      "a4",
      "a1",
      "a2",
      "a3",
    ]);
  });

  it("sorts by duration with the runs that have none always last", async () => {
    expect((await keys({ sort: "durationMs" })).keys).toEqual(["a3", "a1", "a2", "b1", "a4", "b2"]);
    expect((await keys({ sort: "durationMs", order: "asc" })).keys).toEqual([
      "b1",
      "a2",
      "a1",
      "a3",
      "b2",
      "a4",
    ]);
    const { items } = await repository.list({ limit: 50, sort: "durationMs" });
    expect(items[0]?.finishedAt).not.toBeNull();
  });

  it("counts the events of a run", async () => {
    expect(await repository.countEvents(id["a1"]!)).toBe(2);
    expect(await repository.countEvents(id["a4"]!)).toBe(0);
    expect(await repository.countEvents("00000000-0000-4000-8000-000000000000")).toBe(0);
  });

  it("pages with limit and offset and reports the total of the filter", async () => {
    expect(await keys({ limit: 2 })).toEqual({ keys: ["a4", "a3"], total: 6 });
    expect(await keys({ limit: 2, offset: 2 })).toEqual({ keys: ["b1", "a2"], total: 6 });
    expect(await keys({ limit: 2, offset: 10 })).toEqual({ keys: [], total: 6 });
    expect((await keys({ limit: 1, status: "succeeded", offset: 1 })).total).toBe(2);
  });
});
