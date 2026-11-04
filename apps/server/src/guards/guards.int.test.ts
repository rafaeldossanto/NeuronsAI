import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { DrizzleGraphRepository } from "../graphs/drizzle-graph.repository.js";
import { DrizzleGraphVersionRepository } from "../graphs/drizzle-graph-version.repository.js";
import { HUMAN } from "../hub/addresses.js";
import { DrizzleMessageStore } from "../hub/drizzle-message.store.js";
import { eventually } from "../hub/testing/async-helpers.js";
import { createHubHarness, type HubPersistence } from "../hub/testing/hub-harness.js";
import { buildTestGraph } from "../hub/testing/test-graph.js";
import { DrizzleRunEventHistory } from "../realtime/drizzle-run-event-history.js";
import { DrizzleRunEventLog } from "../run-log/drizzle-run-event-log.js";
import { DrizzleRunRepository } from "../run-log/drizzle-run.repository.js";

let testDb: TestDatabase;
let persistence: HubPersistence;
let history: DrizzleRunEventHistory;
let graphId: string;

beforeAll(async () => {
  testDb = await startTestDatabase();
  const { database } = testDb;
  history = new DrizzleRunEventHistory(database);
  persistence = {
    messageStore: new DrizzleMessageStore(database),
    eventLog: new DrizzleRunEventLog(database),
    history,
    runs: new DrizzleRunRepository(database),
    versions: new DrizzleGraphVersionRepository(database),
  };
  graphId = (await new DrizzleGraphRepository(database).create({ name: "Guardas" })).id;
});

afterAll(async () => {
  await testDb.stop();
});

const harnessWith = (options?: Parameters<typeof createHubHarness>[1]) =>
  createHubHarness(persistence, options);

const publish = async () => (await persistence.versions.appendNext(graphId, buildTestGraph())).id;

describe("what the guards read from the database", () => {
  it("counts and lists messages by run, by link and by recency", async () => {
    const harness = harnessWith();
    const runId = await harness.openRun(buildTestGraph(), await publish());
    const other = await harness.openRun(buildTestGraph(), await publish());

    await harness.hub.send(runId, HUMAN, "Alfa", "message", "1");
    await harness.hub.send(runId, "Alfa", "Beta", "message", "2");
    const question = await harness.hub.send(runId, "Beta", "Gama", "ask", "3");
    await harness.hub.reply(runId, "Gama", question.id, "4");
    await harness.hub.send(runId, "Gama", "Beta", "message", "5");
    await harness.hub.send(other, HUMAN, "Alfa", "message", "de outra execução");

    const store = persistence.messageStore;
    expect(await store.countInRun(runId)).toBe(5);
    // Replies do not count, and both directions of the arrow do.
    expect(await store.countOnLink(runId, "Beta", "Gama")).toBe(2);
    expect(await store.countOnLink(runId, "Gama", "Beta")).toBe(2);
    expect(await store.countOnLink(runId, "Alfa", "Beta")).toBe(1);
    expect((await store.listRecent(runId, 3)).map((message) => message.body)).toEqual([
      "5",
      "4",
      "3",
    ]);
    const all = await store.listByRun(runId, { limit: 100 });
    expect(all.map((message) => message.body)).toEqual(["1", "2", "3", "4", "5"]);
    expect(
      (await store.listByRun(runId, { afterSeq: all[1]!.seq, limit: 2 })).map((m) => m.body),
    ).toEqual(["3", "4"]);
  });

  it("reads the events of a run by type and with a limit", async () => {
    const harness = harnessWith();
    const runId = await harness.openRun(buildTestGraph(), await publish());
    await persistence.eventLog.append(runId, [
      { type: "UsageRecorded", agent: "Alfa", payload: { costUsd: 0.1 } },
      { type: "Other", payload: {} },
      { type: "UsageRecorded", agent: "Beta", payload: { costUsd: null } },
    ]);

    expect((await history.readByType(runId, "UsageRecorded")).map((e) => e.agent)).toEqual([
      "Alfa",
      "Beta",
    ]);
    expect((await history.readFrom(runId, 2, 1)).map((event) => event.seq)).toEqual([2]);
  });

  it("keeps the budget of a run and lists runs newest first, filtered", async () => {
    const harness = harnessWith();
    const versionId = await publish();
    const first = await persistence.runs.createRunning(versionId, () => [], { budgetUsd: 1.5 });
    const second = await persistence.runs.createRunning(versionId, () => []);
    await persistence.runs.finish(second.record.id, "cancelled", []);
    void harness;

    expect(first.record.budgetUsd).toBe(1.5);
    expect(second.record.budgetUsd).toBeNull();
    expect((await persistence.runs.findById(first.record.id))?.budgetUsd).toBe(1.5);

    const { items: listed } = await persistence.runs.list({ graphId, limit: 50 });
    const ids = listed.map((run) => run.id);
    expect(ids.indexOf(second.record.id)).toBeLessThan(ids.indexOf(first.record.id));
    expect(listed.every((run) => run.graphId === graphId)).toBe(true);
    const { items: running } = await persistence.runs.list({
      status: "running",
      graphId,
      limit: 50,
    });
    expect(running.map((run) => run.id)).toContain(first.record.id);
    expect(running.map((run) => run.id)).not.toContain(second.record.id);
    expect((await persistence.runs.list({ graphId, limit: 1 })).items).toHaveLength(1);
  });
});

describe("guards on the database", () => {
  it("stops a run at the arrow's limit and keeps the reason in the stored log", async () => {
    const harness = harnessWith({
      scripts: {
        Alfa: async (turn) => {
          for (let index = 0; index < 5; index++) {
            await turn.send("Beta", `m${index}`).catch(() => undefined);
          }
        },
      },
    });
    const graph = buildTestGraph();
    const limited = {
      ...graph,
      links: graph.links.map((link) =>
        link.id === "Alfa-Beta" ? { ...link, maxMessages: 2 } : link,
      ),
    };
    const version = await persistence.versions.appendNext(graphId, limited);

    const run = await harness.runService.start(version.id, "oi");

    await eventually(async () => {
      const stored = await persistence.runs.findById(run.id);
      expect(stored?.status).toBe("failed");
    });
    const events = await history.readFrom(run.id, 1);
    const tripped = events.find((event) => event.type === "GuardTripped");
    const finished = events.find((event) => event.type === "RunFinished");
    expect(tripped?.payload).toMatchObject({ guard: "link_max_messages", limit: 2 });
    expect(finished?.payload).toMatchObject({
      reason: "guard_tripped",
      guard: "link_max_messages",
    });
    expect(tripped!.seq).toBeLessThan(finished!.seq);
  });

  it("adds the cost of the agents up from the log and stops the run at its budget", async () => {
    const harness = harnessWith({
      scripts: {
        Alfa: async (turn) => {
          await turn.usage({ costUsd: 0.04 });
          await turn.usage({ costUsd: 0.04 });
        },
      },
    });

    const run = await harness.runService.start(await publish(), "oi", { budgetUsd: 0.07 });

    await eventually(async () => {
      expect((await persistence.runs.findById(run.id))?.status).toBe("failed");
    });
    const events = await history.readFrom(run.id, 1);
    expect(events.find((event) => event.type === "GuardTripped")?.payload).toMatchObject({
      guard: "run_budget",
      budgetUsd: 0.07,
    });
  });
});
