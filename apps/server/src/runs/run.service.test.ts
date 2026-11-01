import type { GraphDefinition } from "@neurons/graph-schema";
import { beforeEach, describe, expect, it } from "vitest";
import { HUMAN, TRIGGER } from "../hub/addresses.js";
import { AskTimeoutError, RunEndedError, RunNotActiveError } from "../hub/hub.errors.js";
import { deferred, delay, eventually } from "../hub/testing/async-helpers.js";
import { createHubHarness, inMemoryPersistence } from "../hub/testing/hub-harness.js";
import { buildTestGraph } from "../hub/testing/test-graph.js";
import type { FakeScript } from "../agents/testing/fake-agent-runtime.js";
import { GraphVersionNotFoundError, TriggerSelectionError } from "./runs.errors.js";

describe("RunService", () => {
  let persistence: ReturnType<typeof inMemoryPersistence>;
  let versionId: string;

  const harnessWith = (scripts: Record<string, FakeScript> = {}) =>
    createHubHarness(persistence, { scripts });

  const publish = async (graph: GraphDefinition = buildTestGraph()) =>
    (await persistence.versions.appendNext(graph.id, graph)).id;

  beforeEach(async () => {
    persistence = inMemoryPersistence();
    versionId = await publish();
  });

  const finishedEvent = (runId: string) => persistence.runLog.eventsOf(runId, "RunFinished")[0];
  const statusOf = async (runId: string) => (await persistence.runLog.findById(runId))?.status;

  describe("start", () => {
    it("creates a running run, logs RunStarted first and sends the trigger's message to its target", async () => {
      const harness = harnessWith();

      const run = await harness.runService.start(versionId, "faça o relatório");

      expect(run).toMatchObject({ status: "running", graphVersionId: versionId });
      const [first] = persistence.runLog.eventsOf(run.id);
      expect(first).toMatchObject({
        seq: 1,
        type: "RunStarted",
        payload: { graphVersionId: versionId, triggerId: "gatilho", input: "faça o relatório" },
      });
      await eventually(() => {
        expect(harness.runtimes.runtimeOf("Alfa")?.received).toMatchObject([
          { from: TRIGGER, kind: "message", body: "faça o relatório" },
        ]);
      });
      expect(harness.published[0]?.type).toBe("RunStarted");
    });

    it("rejects an unknown graph version", async () => {
      await expect(
        harnessWith().runService.start("00000000-0000-0000-0000-000000000000", "x"),
      ).rejects.toBeInstanceOf(GraphVersionNotFoundError);
    });

    it("needs a trigger, and asks which one when there are several", async () => {
      const graph = buildTestGraph();
      const noTrigger = await publish({ ...graph, nodes: graph.nodes.slice(1) });
      const twoTriggers = await publish({
        ...graph,
        nodes: [
          ...graph.nodes,
          {
            id: "segundo",
            type: "trigger",
            position: { x: 0, y: 0 },
            kind: "manual",
            target: "agente-beta",
          },
        ],
      });
      const { runService } = harnessWith();

      await expect(runService.start(noTrigger, "x")).rejects.toBeInstanceOf(TriggerSelectionError);
      await expect(runService.start(twoTriggers, "x")).rejects.toBeInstanceOf(
        TriggerSelectionError,
      );
      await expect(
        runService.start(twoTriggers, "x", { triggerId: "inexistente" }),
      ).rejects.toBeInstanceOf(TriggerSelectionError);
      const run = await runService.start(twoTriggers, "x", { triggerId: "segundo" });
      expect(persistence.runLog.eventsOf(run.id, "RunStarted")[0]?.payload).toMatchObject({
        triggerId: "segundo",
      });
    });
  });

  describe("finishing", () => {
    it("ends the run when an agent calls finish, and stops every runtime", async () => {
      const harness = harnessWith({
        Alfa: async (turn) => {
          await turn.send("Beta", "ajude");
        },
        Beta: (turn) => turn.finish("tudo pronto"),
      });

      const run = await harness.runService.start(versionId, "oi");

      await eventually(() => expect(finishedEvent(run.id)).toBeDefined());
      expect(finishedEvent(run.id)).toMatchObject({
        agent: "Beta",
        payload: { reason: "finished", agent: "Beta", result: "tudo pronto" },
      });
      expect(await statusOf(run.id)).toBe("succeeded");
      await eventually(() => {
        expect(harness.runtimes.created.map((runtime) => runtime.state)).toEqual([
          "stopped",
          "stopped",
        ]);
      });
      expect(harness.published.map((event) => event.type)).toContain("RunFinished");
    });

    it("ends as quiescent when everyone is idle with nothing pending", async () => {
      const harness = harnessWith({
        Alfa: (turn) => turn.send("Beta", "passe adiante").then(() => undefined),
        Beta: async (turn) => {
          await turn.work(20);
          await turn.send("Gama", "último");
        },
        Gama: (turn) => turn.work(20),
      });

      const run = await harness.runService.start(versionId, "oi");

      await eventually(() => expect(finishedEvent(run.id)).toBeDefined());
      expect(finishedEvent(run.id)?.payload).toMatchObject({ reason: "quiescent" });
      expect(await statusOf(run.id)).toBe("succeeded");
      expect(harness.runtimes.runtimeOf("Gama")?.received.map((m) => m.body)).toEqual(["último"]);
      expect(harness.runtimes.created.every((runtime) => runtime.state === "stopped")).toBe(true);
    });

    it("is not quiescent while an ask is open, even with every agent idle", async () => {
      const gate = deferred();
      const harness = harnessWith({ Alfa: () => gate.promise });
      const run = await harness.runService.start(versionId, "oi");
      await eventually(() => expect(harness.runtimes.runtimeOf("Alfa")?.state).toBe("busy"));
      // A human asks Beta, which never answers. Once Alfa is idle too, only the open ask holds the run.
      const asked = harness.hub
        .ask(run.id, HUMAN, "Beta", "alguém aí?", 120)
        .catch((e: unknown) => e);
      await eventually(() => expect(harness.runtimes.runtimeOf("Beta")?.received).toHaveLength(1));
      gate.resolve();
      await eventually(() => expect(harness.runtimes.runtimeOf("Alfa")?.state).toBe("idle"));

      await delay(60);
      expect(await statusOf(run.id)).toBe("running");

      expect(await asked).toBeInstanceOf(AskTimeoutError);
      await eventually(() => expect(finishedEvent(run.id)).toBeDefined());
      expect(finishedEvent(run.id)?.payload).toMatchObject({ reason: "quiescent" });
    });

    it("is not quiescent while a message waits for a busy agent", async () => {
      const harness = harnessWith({
        Alfa: async (turn) => {
          await turn.send("Beta", "um");
          await turn.send("Beta", "dois");
        },
        Beta: (turn) => turn.work(40),
      });

      const run = await harness.runService.start(versionId, "oi");

      await eventually(() => expect(finishedEvent(run.id)).toBeDefined());
      // The run only ended after the queued message was handled.
      expect(harness.runtimes.runtimeOf("Beta")?.received.map((m) => m.body)).toEqual([
        "um",
        "dois",
      ]);
    });

    it("does not leave the run hanging when a pending message targets an agent that failed", async () => {
      const harness = createHubHarness(persistence, {
        scripts: { Alfa: (turn) => turn.send("Beta", "oi").then(() => undefined) },
        runtimeOptions: { Beta: { failOnStart: "sem memória" } },
      });

      const run = await harness.runService.start(versionId, "oi");

      await eventually(() => expect(finishedEvent(run.id)).toBeDefined());
      expect(persistence.runLog.eventsOf(run.id, "AgentFailed")[0]).toMatchObject({
        agent: "Beta",
        payload: { reason: "sem memória" },
      });
      expect(finishedEvent(run.id)?.payload).toMatchObject({ reason: "quiescent" });
    });

    it("refuses new messages once the run ended", async () => {
      const harness = harnessWith({ Alfa: (turn) => turn.finish("pronto") });
      const run = await harness.runService.start(versionId, "oi");
      await eventually(() => expect(finishedEvent(run.id)).toBeDefined());

      await expect(
        harness.hub.send(run.id, HUMAN, "Alfa", "message", "ainda aí?"),
      ).rejects.toBeInstanceOf(RunNotActiveError);
    });
  });

  describe("stop", () => {
    it("stops the run by hand, cancels open asks and stops the runtimes", async () => {
      const harness = harnessWith({ Alfa: (turn) => turn.work(10_000) });
      const run = await harness.runService.start(versionId, "oi");
      await eventually(() => expect(harness.runtimes.runtimeOf("Alfa")?.state).toBe("busy"));
      const asked = harness.hub.ask(run.id, HUMAN, "Beta", "alguém aí?").catch((e: unknown) => e);

      await harness.runService.stop(run.id);

      expect(await asked).toBeInstanceOf(RunEndedError);
      expect(finishedEvent(run.id)?.payload).toMatchObject({ reason: "stopped" });
      expect(await statusOf(run.id)).toBe("cancelled");
      expect(harness.runtimes.created.every((runtime) => runtime.state === "stopped")).toBe(true);
    });

    it("is harmless when the run already ended", async () => {
      const harness = harnessWith({ Alfa: (turn) => turn.finish("pronto") });
      const run = await harness.runService.start(versionId, "oi");
      await eventually(() => expect(finishedEvent(run.id)).toBeDefined());

      await harness.runService.stop(run.id);

      expect(persistence.runLog.eventsOf(run.id, "RunFinished")).toHaveLength(1);
    });
  });
});
