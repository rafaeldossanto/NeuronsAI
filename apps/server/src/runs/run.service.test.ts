import type { GraphDefinition } from "@neurons/graph-schema";
import { beforeEach, describe, expect, it } from "vitest";
import { HUMAN, TRIGGER } from "../hub/addresses.js";
import { RunEndedError, RunNotActiveError } from "../hub/hub.errors.js";
import { deferred, eventually } from "../hub/testing/async-helpers.js";
import { createHubHarness, inMemoryPersistence } from "../hub/testing/hub-harness.js";
import { buildTestGraph } from "../hub/testing/test-graph.js";
import type { FakeScript } from "../agents/testing/fake-agent-runtime.js";
import { resourceScope } from "../accounts/resource-scope.js";
import { QuotaExceededError } from "../shared/errors/quota-exceeded.error.js";
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

  describe("quotas", () => {
    const ORG = "0b000000-0000-4000-8000-000000000001";
    const inOrganization = <T>(action: () => T): T =>
      resourceScope.run({ organizationId: ORG }, action);

    it("refuses a run beyond the concurrent limit, with a message in Portuguese (HTTP 429)", async () => {
      const { runService, runtimes } = createHubHarness(persistence, {
        runQuotas: { concurrentRunsPerOrganization: 1, runsPerDayPerOrganization: 0 },
      });
      runtimes.setScript("Alfa", () => new Promise<void>(() => {}));
      const first = await inOrganization(() => runService.start(versionId, "um"));

      const refused = await inOrganization(() => runService.start(versionId, "dois")).catch(
        (error: unknown) => error,
      );

      expect(refused).toBeInstanceOf(QuotaExceededError);
      expect(refused).toMatchObject({
        kind: "quota_exceeded",
        code: "quota_concurrent_runs",
        message: expect.stringContaining("em andamento") as string,
      });
      await runService.stop(first.id);
      await expect(
        inOrganization(() => runService.start(versionId, "três")),
      ).resolves.toBeDefined();
    });

    it("lets only the limit through when the starts arrive at the same moment", async () => {
      const { runService, runtimes } = createHubHarness(persistence, {
        runQuotas: { concurrentRunsPerOrganization: 2, runsPerDayPerOrganization: 0 },
      });
      runtimes.setScript("Alfa", () => new Promise<void>(() => {}));

      const results = await Promise.allSettled(
        Array.from({ length: 6 }, (_, index) =>
          inOrganization(() => runService.start(versionId, `entrada ${String(index)}`)),
        ),
      );

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(4);
    });

    it("refuses a run beyond the daily limit, counting the last 24 hours", async () => {
      const { runService } = createHubHarness(persistence, {
        runQuotas: { concurrentRunsPerOrganization: 0, runsPerDayPerOrganization: 2 },
      });
      for (const input of ["a", "b"]) {
        await inOrganization(() => runService.start(versionId, input));
      }

      await expect(inOrganization(() => runService.start(versionId, "c"))).rejects.toMatchObject({
        code: "quota_runs_per_day",
      });
    });

    it("does not limit the local workspace, which has no organization", async () => {
      const { runService } = createHubHarness(persistence, {
        runQuotas: { concurrentRunsPerOrganization: 1, runsPerDayPerOrganization: 1 },
      });

      await runService.start(versionId, "a");
      await expect(runService.start(versionId, "b")).resolves.toBeDefined();
    });
  });

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
      // A human asks Beta, which does not answer by itself. Once Alfa is idle too, only the open
      // ask holds the run. The timeout is far away: the test ends the ask itself, so no timing matters.
      const asked = harness.hub.ask(run.id, HUMAN, "Beta", "alguém aí?", 600_000);
      await eventually(() => expect(harness.runtimes.runtimeOf("Beta")?.received).toHaveLength(1));
      gate.resolve();
      await eventually(() => expect(harness.runtimes.runtimeOf("Alfa")?.state).toBe("idle"));
      await eventually(() => expect(harness.runtimes.runtimeOf("Beta")?.state).toBe("idle"));

      expect(await harness.supervisor.isQuiescent(run.id)).toBe(false);
      expect(await statusOf(run.id)).toBe("running");

      const question = harness.runtimes.runtimeOf("Beta")?.received[0];
      await harness.hub.reply(run.id, "Beta", question!.id, "estou aqui");
      expect(await asked).toBe("estou aqui");
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
