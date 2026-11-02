import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { messages, runEvents, runs } from "../database/schema/index.js";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { DrizzleGraphRepository } from "../graphs/drizzle-graph.repository.js";
import { DrizzleGraphVersionRepository } from "../graphs/drizzle-graph-version.repository.js";
import { DrizzleRunEventHistory } from "../realtime/drizzle-run-event-history.js";
import { DrizzleRunEventLog } from "../run-log/drizzle-run-event-log.js";
import { DrizzleRunRepository } from "../run-log/drizzle-run.repository.js";
import { HUMAN } from "./addresses.js";
import { DrizzleMessageStore } from "./drizzle-message.store.js";
import { HubEvents } from "./hub-events.js";
import { eventually } from "./testing/async-helpers.js";
import {
  createHubHarness,
  type HubHarnessOptions,
  type HubPersistence,
} from "./testing/hub-harness.js";
import { buildTestGraph } from "./testing/test-graph.js";

let testDb: TestDatabase;
let persistence: HubPersistence;
let versionId: string;

beforeAll(async () => {
  testDb = await startTestDatabase();
  const { database } = testDb;
  persistence = {
    messageStore: new DrizzleMessageStore(database),
    eventLog: new DrizzleRunEventLog(database),
    history: new DrizzleRunEventHistory(database),
    runs: new DrizzleRunRepository(database),
    versions: new DrizzleGraphVersionRepository(database),
  };
  const graph = await new DrizzleGraphRepository(database).create({ name: "Hub" });
  const version = await persistence.versions.appendNext(graph.id, buildTestGraph());
  versionId = version.id;
});

afterAll(async () => {
  await testDb.stop();
});

const db = () => testDb.database.db;
const harnessWith = (options?: HubHarnessOptions) => createHubHarness(persistence, options);
const openRun = (harness: ReturnType<typeof harnessWith>) =>
  harness.openRun(buildTestGraph(), versionId);

/** Every seq of the run's log, ascending. */
async function loggedSeqs(runId: string): Promise<number[]> {
  const rows = await db()
    .select({ seq: runEvents.seq })
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.seq));
  return rows.map((row) => row.seq);
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("Hub", () => {
  it("stores the message and its MessageSent event in the same transaction", async () => {
    const harness = harnessWith();
    const runId = await openRun(harness);

    const message = await harness.hub.send(runId, HUMAN, "Delta", "message", "oi");

    const [event] = await db()
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "MessageSent")));
    expect(event).toMatchObject({ runId, seq: message.seq, agent: HUMAN });
    expect(event?.payload).toMatchObject({ messageId: message.id, body: "oi" });
    const [row] = await db().select().from(messages).where(eq(messages.id, message.id));
    expect(row).toMatchObject({ runId, seq: message.seq, fromAgent: HUMAN, toAgent: "Delta" });
  });

  it("rolls the message back, and the seq with it, when its event cannot be stored", async () => {
    const harness = harnessWith();
    const runId = await openRun(harness);
    const before = await db().select().from(runs).where(eq(runs.id, runId));

    await expect(
      persistence.messageStore.append(
        {
          runId,
          from: HUMAN,
          to: "Delta",
          kind: "message",
          replyTo: null,
          body: "x",
          deliveredOnArrival: false,
        },
        () => {
          throw new Error("falha ao montar o evento");
        },
      ),
    ).rejects.toThrow("falha ao montar o evento");

    expect(await db().select().from(messages).where(eq(messages.runId, runId))).toEqual([]);
    const [after] = await db().select().from(runs).where(eq(runs.id, runId));
    expect(after?.lastSeq).toBe(before[0]?.lastSeq);
  });

  it("allocates event seqs without gaps or repeats under concurrent writers", async () => {
    const harness = harnessWith();
    const runId = await openRun(harness);

    await Promise.all(
      Array.from({ length: 20 }, (_, writer) =>
        persistence.eventLog.append(
          runId,
          [1, 2, 3].map((n) => ({ type: "Probe", payload: { writer, n } })),
        ),
      ),
    );

    expect(await loggedSeqs(runId)).toEqual(range(1, 60));
  });

  it("keeps seq gap-free and unique with concurrent sends, deliveries and acknowledgements", async () => {
    const harness = harnessWith();
    const runId = await openRun(harness);
    const total = 30;

    const sent = await Promise.all(
      Array.from({ length: total }, (_, index) =>
        harness.hub.send(runId, HUMAN, index % 2 ? "Beta" : "Gama", "message", `mensagem ${index}`),
      ),
    );

    await eventually(async () => {
      const unacked = await persistence.messageStore.listUnacked(runId);
      expect(unacked).toEqual([]);
    });
    // 30 MessageSent + 30 MessageDelivered + 2 AgentStarted.
    expect(await loggedSeqs(runId)).toEqual(range(1, total * 2 + 2));
    const messageSeqs = sent.map((message) => message.seq);
    expect(new Set(messageSeqs).size).toBe(total);
    // Each message holds the seq of its own MessageSent event.
    const sentEvents = await db().select().from(runEvents).where(eq(runEvents.type, "MessageSent"));
    const loggedMessageSeqs = sentEvents
      .filter((event) => event.runId === runId)
      .map((event) => event.seq);
    expect([...loggedMessageSeqs].sort((a, b) => a - b)).toEqual(
      [...messageSeqs].sort((a, b) => a - b),
    );
  });

  it("hands each agent its messages in the order they were stored", async () => {
    const harness = harnessWith();
    const runId = await openRun(harness);

    for (let index = 0; index < 8; index++) {
      await harness.hub.send(runId, HUMAN, "Beta", "message", `m${index}`);
    }

    await eventually(() => {
      expect(harness.runtimes.runtimeOf("Beta")?.received.map((m) => m.body)).toEqual(
        range(0, 7).map((index) => `m${index}`),
      );
    });
  });

  it("writes MessageDelivered once, when the runtime confirms the message", async () => {
    const harness = harnessWith();
    const runId = await openRun(harness);
    const message = await harness.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(async () => {
      expect((await persistence.messageStore.findById(message.id))?.ackedAt).not.toBeNull();
    });

    // A second acknowledgement of the same message changes nothing and writes no event.
    expect(
      await persistence.messageStore.markAcked(message.id, HubEvents.messageDelivered),
    ).toBeUndefined();

    const delivered = await db()
      .select()
      .from(runEvents)
      .where(eq(runEvents.type, "MessageDelivered"));
    expect(delivered.filter((event) => event.runId === runId)).toHaveLength(1);
  });

  it("lets only one caller finish a run", async () => {
    const harness = harnessWith();
    const runId = await openRun(harness);

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        persistence.runs.finish(runId, "succeeded", [{ type: "RunFinished", payload: {} }]),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await loggedSeqs(runId)).toEqual([1]);
  });

  describe("recover", () => {
    it("hands over again, after a restart, what was delivered but never acknowledged", async () => {
      const before = harnessWith({ runtimeOptions: { Beta: { neverAck: true } } });
      const runId = await openRun(before);
      const first = await before.hub.send(runId, HUMAN, "Beta", "message", "primeira");
      await before.hub.send(runId, HUMAN, "Beta", "message", "segunda");
      await eventually(async () => {
        expect((await persistence.messageStore.findById(first.id))?.deliveredAt).not.toBeNull();
      });
      expect((await persistence.messageStore.findById(first.id))?.ackedAt).toBeNull();

      // "Restart": brand new Hub, Supervisor and runtimes over the same database.
      const after = harnessWith();
      await after.supervisor.recover();

      await eventually(() => {
        expect(after.runtimes.runtimeOf("Beta")?.received.map((m) => m.body)).toEqual([
          "primeira",
          "segunda",
        ]);
      });
      await eventually(async () => {
        expect(await persistence.messageStore.listUnacked(runId)).toEqual([]);
      });
      // 2 MessageSent, AgentStarted before and after the restart, 2 MessageDelivered.
      const seqs = await loggedSeqs(runId);
      expect(seqs).toEqual(range(1, 6));
      const started = await db().select().from(runEvents).where(eq(runEvents.type, "AgentStarted"));
      expect(started.filter((event) => event.runId === runId)).toHaveLength(2);
    });

    it("leaves ended runs alone", async () => {
      const harness = harnessWith();
      const runId = await openRun(harness);
      await harness.runService.stop(runId);

      const after = harnessWith();
      await after.supervisor.recover();

      expect(after.registry.find(runId)).toBeUndefined();
    });
  });

  describe("a whole run", () => {
    it("starts, conversation flows and ends quiescent, with the log replayable from any seq", async () => {
      const harness = harnessWith({
        scripts: {
          Alfa: async (turn) => {
            if (turn.message.from === "@trigger") await turn.send("Beta", "ajude");
          },
          Beta: async (turn) => {
            if (turn.message.from === "Alfa") await turn.reply("feito");
          },
        },
      });

      const run = await harness.runService.start(versionId, "comece");

      await eventually(async () => {
        const [row] = await db().select().from(runs).where(eq(runs.id, run.id));
        expect(row?.status).toBe("succeeded");
      });
      const [row] = await db().select().from(runs).where(eq(runs.id, run.id));
      expect(row?.finishedAt).not.toBeNull();
      const history = new DrizzleRunEventHistory(testDb.database);
      const events = await history.readFrom(run.id, 1);
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          "RunStarted",
          "MessageSent",
          "AgentStarted",
          "MessageDelivered",
          "RunFinished",
        ]),
      );
      expect(events[0]?.type).toBe("RunStarted");
      expect(events.map((event) => event.seq)).toEqual(range(1, events.length));
      expect((await history.readFrom(run.id, 3)).map((event) => event.seq)).toEqual(
        range(3, events.length),
      );
      // Everything the subscribers saw is what was stored.
      expect(
        harness.published.filter((event) => event.runId === run.id).map((event) => event.seq),
      ).toEqual(expect.arrayContaining(range(1, events.length)));
    });

    it("answers an ask across agents through the database", async () => {
      let answer: string | undefined;
      const harness = harnessWith({
        scripts: {
          Alfa: async (turn) => {
            if (turn.message.from === "@trigger") answer = await turn.ask("Beta", "quanto é 6x7?");
          },
          Beta: (turn) => turn.reply("42").then(() => undefined),
        },
      });

      const run = await harness.runService.start(versionId, "comece");

      await eventually(() => expect(answer).toBe("42"));
      await eventually(async () => {
        const replies = await db()
          .select()
          .from(messages)
          .where(and(eq(messages.runId, run.id), eq(messages.kind, "reply")));
        expect(replies).toMatchObject([{ fromAgent: "Beta", toAgent: "Alfa" }]);
        expect(replies[0]?.ackedAt).not.toBeNull();
      });
      // Let the run end before the database goes away.
      await eventually(async () => {
        const [row] = await db().select().from(runs).where(eq(runs.id, run.id));
        expect(row?.status).toBe("succeeded");
      });
    });
  });
});
