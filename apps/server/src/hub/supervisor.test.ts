import { peersOf } from "@neurons/graph-schema";
import { beforeEach, describe, expect, it } from "vitest";
import { buildBriefing } from "./briefing.js";
import { HUMAN } from "./addresses.js";
import { eventually } from "./testing/async-helpers.js";
import { createHubHarness, inMemoryPersistence } from "./testing/hub-harness.js";
import { buildTestGraph } from "./testing/test-graph.js";

describe("Supervisor", () => {
  let persistence: ReturnType<typeof inMemoryPersistence>;

  beforeEach(() => {
    persistence = inMemoryPersistence();
  });

  it("starts an agent only when it receives its first message, logging AgentStarted with the briefing", async () => {
    const harness = createHubHarness(persistence);
    const runId = await harness.openRun();
    expect(harness.runtimes.created).toEqual([]);

    await harness.hub.send(runId, HUMAN, "Beta", "message", "oi");

    await eventually(() => expect(harness.runtimes.runtimeOf("Beta")?.received).toHaveLength(1));
    const graph = buildTestGraph();
    const beta = graph.nodes.find((node) => node.type === "agent" && node.name === "Beta");
    if (beta?.type !== "agent") throw new Error("no Beta");
    const expectedBriefing = buildBriefing(beta, peersOf(graph, "Beta"));
    expect(harness.runtimes.runtimeOf("Beta")?.briefing).toBe(expectedBriefing);
    expect(persistence.runLog.eventsOf(runId, "AgentStarted")).toMatchObject([
      { agent: "Beta", payload: { briefing: expectedBriefing } },
    ]);
    expect(harness.runtimes.created.map((runtime) => runtime.name)).toEqual(["Beta"]);
  });

  it("logs AgentStarted before the first MessageDelivered", async () => {
    const harness = createHubHarness(persistence);
    const runId = await harness.openRun();

    await harness.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() =>
      expect(persistence.runLog.eventsOf(runId, "MessageDelivered")).toHaveLength(1),
    );

    const types = persistence.runLog
      .eventsOf(runId)
      .map((event) => event.type)
      .filter((type) => type !== "AgentStateChanged");
    expect(types).toEqual(["MessageSent", "AgentStarted", "MessageDelivered"]);
  });

  it("hands the inbox to an agent in order, one message per idle moment", async () => {
    const harness = createHubHarness(persistence, {
      scripts: { Beta: (turn) => turn.work(10) },
    });
    const runId = await harness.openRun();

    for (const body of ["a", "b", "c", "d"]) {
      await harness.hub.send(runId, HUMAN, "Beta", "message", body);
    }

    await eventually(() => {
      expect(harness.runtimes.runtimeOf("Beta")?.received.map((m) => m.body)).toEqual([
        "a",
        "b",
        "c",
        "d",
      ]);
    });
    await eventually(() =>
      expect(persistence.messageStore.allOf(runId).every((m) => m.ackedAt)).toBe(true),
    );
  });

  it("keeps serving other agents while one is busy", async () => {
    const harness = createHubHarness(persistence, {
      scripts: { Beta: (turn) => turn.work(200) },
    });
    const runId = await harness.openRun();

    await harness.hub.send(runId, HUMAN, "Beta", "message", "lento");
    await harness.hub.send(runId, HUMAN, "Gama", "message", "rápido");

    await eventually(() => expect(harness.runtimes.runtimeOf("Gama")?.received).toHaveLength(1));
    expect(harness.runtimes.runtimeOf("Beta")?.state).toBe("busy");
  });

  it("records AgentFailed when the runtime cannot be created and keeps the message unacknowledged", async () => {
    const harness = createHubHarness(persistence);
    harness.runtimes.create = () => {
      throw new Error("runtime indisponível");
    };
    const runId = await harness.openRun();

    const message = await harness.hub.send(runId, HUMAN, "Beta", "message", "oi");

    await eventually(() =>
      expect(persistence.runLog.eventsOf(runId, "AgentFailed")).toHaveLength(1),
    );
    expect(persistence.runLog.eventsOf(runId, "AgentFailed")[0]?.payload).toMatchObject({
      reason: "runtime indisponível",
    });
    expect((await persistence.messageStore.findById(message.id))?.ackedAt).toBeNull();
  });

  describe("recover", () => {
    it("hands over again what was delivered but never acknowledged, in order, after a restart", async () => {
      const before = createHubHarness(persistence, {
        runtimeOptions: { Beta: { neverAck: true } },
      });
      const runId = await before.openRun();
      const first = await before.hub.send(runId, HUMAN, "Beta", "message", "primeira");
      await before.hub.send(runId, HUMAN, "Beta", "message", "segunda");
      await eventually(async () => {
        expect((await persistence.messageStore.findById(first.id))?.deliveredAt).not.toBeNull();
      });
      expect((await persistence.messageStore.findById(first.id))?.ackedAt).toBeNull();

      // "Restart": new Hub, Supervisor and runtimes over the same storage.
      const after = createHubHarness(persistence);
      await after.supervisor.recover();

      await eventually(() => {
        expect(after.runtimes.runtimeOf("Beta")?.received.map((m) => m.body)).toEqual([
          "primeira",
          "segunda",
        ]);
      });
      await eventually(() =>
        expect(persistence.messageStore.allOf(runId).every((m) => m.ackedAt)).toBe(true),
      );
    });

    it("keeps the first delivery timestamp when redelivering", async () => {
      const before = createHubHarness(persistence, {
        runtimeOptions: { Beta: { neverAck: true } },
      });
      const runId = await before.openRun();
      const message = await before.hub.send(runId, HUMAN, "Beta", "message", "oi");
      await eventually(async () => {
        expect((await persistence.messageStore.findById(message.id))?.deliveredAt).not.toBeNull();
      });
      const firstDelivery = (await persistence.messageStore.findById(message.id))?.deliveredAt;

      const after = createHubHarness(persistence);
      await after.supervisor.recover();
      await eventually(async () => {
        expect((await persistence.messageStore.findById(message.id))?.ackedAt).not.toBeNull();
      });

      expect((await persistence.messageStore.findById(message.id))?.deliveredAt).toEqual(
        firstDelivery,
      );
    });

    it("does not touch runs that already ended", async () => {
      const before = createHubHarness(persistence);
      const runId = await before.openRun();
      await before.runService.stop(runId);

      const after = createHubHarness(persistence);
      await after.supervisor.recover();

      expect(after.registry.find(runId)).toBeUndefined();
      expect(after.runtimes.created).toEqual([]);
    });

    it("lets a recovered run with nothing left to deliver end as quiescent", async () => {
      const before = createHubHarness(persistence);
      const runId = await before.openRun();

      const after = createHubHarness(persistence);
      void after.runService;
      await after.supervisor.recover();

      await eventually(() => {
        expect(persistence.runLog.eventsOf(runId, "RunFinished")[0]?.payload).toMatchObject({
          reason: "quiescent",
        });
      });
    });
  });
});
