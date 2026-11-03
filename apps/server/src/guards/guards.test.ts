import type { AgentNode, GraphDefinition } from "@neurons/graph-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeScript } from "../agents/testing/fake-agent-runtime.js";
import { HUMAN } from "../hub/addresses.js";
import { MessageDeniedError } from "../hub/hub.errors.js";
import { eventually } from "../hub/testing/async-helpers.js";
import {
  createHubHarness,
  inMemoryPersistence,
  type HubHarnessOptions,
} from "../hub/testing/hub-harness.js";
import { buildTestGraph } from "../hub/testing/test-graph.js";

/** The test graph with the given agents changed and the link `Alfa -> Beta` adjusted. */
function graphWith(
  agentChanges: Record<string, Partial<AgentNode>> = {},
  linkChanges: Partial<GraphDefinition["links"][number]> = {},
): GraphDefinition {
  const graph = buildTestGraph();
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.type === "agent" && agentChanges[node.name]
        ? { ...node, ...agentChanges[node.name] }
        : node,
    ),
    links: graph.links.map((link) =>
      link.id === "Alfa-Beta" ? { ...link, ...linkChanges } : link,
    ),
  };
}

describe("guards", () => {
  let persistence: ReturnType<typeof inMemoryPersistence>;

  beforeEach(() => {
    persistence = inMemoryPersistence();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const harnessWith = (options: HubHarnessOptions = {}) => createHubHarness(persistence, options);
  const publish = async (graph: GraphDefinition) =>
    (await persistence.versions.appendNext(graph.id, graph)).id;
  const eventsOf = (runId: string, type: string) => persistence.runLog.eventsOf(runId, type);
  const statusOf = async (runId: string) => (await persistence.runLog.findById(runId))?.status;
  const finished = (runId: string) => eventsOf(runId, "RunFinished")[0];

  /** A script that sends to Beta until something refuses, and remembers what refused. */
  const spammer = (sent: string[], refusals: unknown[]): FakeScript => {
    return async (turn) => {
      for (let index = 1; index <= 10; index++) {
        try {
          await turn.send("Beta", `mensagem ${index}`);
          sent.push(`mensagem ${index}`);
        } catch (error) {
          refusals.push(error);
          return;
        }
      }
    };
  };

  describe("messages per run", () => {
    it("stops the run, with the reason in the log, when it reaches the limit", async () => {
      const sent: string[] = [];
      const refusals: unknown[] = [];
      const harness = harnessWith({
        scripts: { Alfa: spammer(sent, refusals) },
        limits: { runMaxMessages: 4 },
      });
      const run = await harness.runService.start(await publish(buildTestGraph()), "oi");

      await eventually(() => expect(finished(run.id)).toBeDefined());

      // The trigger's message plus three from Alfa fill the limit; the next one is refused.
      expect(sent).toHaveLength(3);
      expect(refusals[0]).toBeInstanceOf(MessageDeniedError);
      expect((refusals[0] as MessageDeniedError).code).toBe("run_message_limit");
      expect(eventsOf(run.id, "GuardTripped")[0]).toMatchObject({
        payload: { guard: "run_max_messages", scope: "run", limit: 4 },
      });
      expect(finished(run.id)?.payload).toMatchObject({
        reason: "guard_tripped",
        guard: "run_max_messages",
        message: expect.stringContaining("4 mensagens") as string,
      });
      expect(await statusOf(run.id)).toBe("failed");
      expect(harness.runtimes.created.every((runtime) => runtime.state === "stopped")).toBe(true);
    });
  });

  describe("messages per link", () => {
    it("stops the run when the arrow's maxMessages is used up", async () => {
      const sent: string[] = [];
      const refusals: unknown[] = [];
      const harness = harnessWith({ scripts: { Alfa: spammer(sent, refusals) } });
      const version = await publish(graphWith({}, { maxMessages: 2 }));
      const run = await harness.runService.start(version, "oi");

      await eventually(() => expect(finished(run.id)).toBeDefined());

      expect(sent).toHaveLength(2);
      expect((refusals[0] as MessageDeniedError).code).toBe("link_message_limit");
      expect(eventsOf(run.id, "GuardTripped")[0]).toMatchObject({
        payload: { guard: "link_max_messages", linkId: "Alfa-Beta", limit: 2 },
      });
      expect(finished(run.id)?.payload).toMatchObject({ reason: "guard_tripped" });
    });

    it("never refuses a reply, which closes a question the limit let through", async () => {
      const harness = harnessWith({
        scripts: {
          Alfa: async (turn) => {
            await turn.ask("Beta", "pronto?");
            await turn.finish("fechado");
          },
          Beta: (turn) => turn.reply("sim").then(() => undefined),
        },
      });
      const version = await publish(graphWith({}, { maxMessages: 1 }));
      const run = await harness.runService.start(version, "oi");

      await eventually(() => expect(finished(run.id)).toBeDefined());

      expect(finished(run.id)?.payload).toMatchObject({ reason: "finished" });
      expect(eventsOf(run.id, "GuardTripped")).toEqual([]);
    });

    it("does not limit an arrow without maxMessages, nor the human", async () => {
      const harness = harnessWith();
      const runId = await harness.openRun();

      for (let index = 0; index < 5; index++) {
        await harness.hub.send(runId, "Alfa", "Beta", "message", `m${index}`);
        await harness.hub.send(runId, HUMAN, "Beta", "message", `h${index}`);
      }

      expect(eventsOf(runId, "GuardTripped")).toEqual([]);
    });
  });

  describe("ping-pong", () => {
    const openRun = async (threshold: number) => {
      const harness = harnessWith({ limits: { pingPongMessages: threshold } });
      return { harness, runId: await harness.openRun() };
    };

    it("trips on the message that makes N in a row between the same two agents", async () => {
      const { harness, runId } = await openRun(4);
      await harness.hub.send(runId, "Beta", "Gama", "message", "1");
      await harness.hub.send(runId, "Gama", "Beta", "message", "2");
      await harness.hub.send(runId, "Beta", "Gama", "message", "3");
      expect(eventsOf(runId, "GuardTripped")).toEqual([]);

      const refused = await harness.hub
        .send(runId, "Gama", "Beta", "message", "4")
        .catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(MessageDeniedError);
      expect((refused as MessageDeniedError).code).toBe("ping_pong");
      await eventually(() => expect(eventsOf(runId, "GuardTripped")).toHaveLength(1));
      expect(eventsOf(runId, "GuardTripped")[0]?.payload).toMatchObject({
        guard: "ping_pong",
        scope: "run",
        agents: ["Gama", "Beta"],
        messages: 4,
      });
    });

    it("starts over when a third agent steps in", async () => {
      const { harness, runId } = await openRun(4);
      await harness.hub.send(runId, "Beta", "Gama", "message", "1");
      await harness.hub.send(runId, "Gama", "Beta", "message", "2");
      await harness.hub.send(runId, "Alfa", "Beta", "message", "um terceiro");
      await harness.hub.send(runId, "Gama", "Beta", "message", "3");
      await harness.hub.send(runId, "Beta", "Gama", "message", "4");

      expect(eventsOf(runId, "GuardTripped")).toEqual([]);
    });

    it("starts over when a person steps in", async () => {
      const { harness, runId } = await openRun(4);
      await harness.hub.send(runId, "Beta", "Gama", "message", "1");
      await harness.hub.send(runId, "Gama", "Beta", "message", "2");
      await harness.hub.send(runId, HUMAN, "Gama", "message", "calma aí");
      await harness.hub.send(runId, "Gama", "Beta", "message", "3");
      await harness.hub.send(runId, "Beta", "Gama", "message", "4");

      expect(eventsOf(runId, "GuardTripped")).toEqual([]);
    });

    it("is not about one agent talking alone: that is what the link limit is for", async () => {
      const { harness, runId } = await openRun(3);
      for (let index = 0; index < 6; index++) {
        await harness.hub.send(runId, "Beta", "Gama", "message", `sozinho ${index}`);
      }
      expect(eventsOf(runId, "GuardTripped")).toEqual([]);
    });

    it("ends a real run whose two agents keep answering each other", async () => {
      const bounce: FakeScript = async (turn) => {
        await turn.send(turn.message.from, `de volta ${turn.message.body}`).catch(() => undefined);
      };
      const harness = harnessWith({
        scripts: {
          // The first message comes from the trigger; after that the two answer each other.
          Alfa: (turn) =>
            turn.message.from === "Beta"
              ? bounce(turn)
              : turn.send("Beta", "começa").then(() => undefined),
          Beta: bounce,
        },
        limits: { pingPongMessages: 6 },
      });
      const version = await publish(graphWith({}, { bidirectional: true }));
      const run = await harness.runService.start(version, "oi");

      await eventually(() => expect(finished(run.id)).toBeDefined());

      expect(finished(run.id)?.payload).toMatchObject({
        reason: "guard_tripped",
        guard: "ping_pong",
      });
    });
  });

  describe("budget", () => {
    it("stops only the agent that spent its budget, and says why", async () => {
      const harness = harnessWith({
        scripts: {
          Alfa: async (turn) => {
            await turn.usage({ costUsd: 0.03 });
            await turn.usage({ costUsd: 0.03 });
            await turn.work(10_000);
          },
        },
      });
      const version = await publish(graphWith({ Alfa: { budgetUsd: 0.05 } }));
      const run = await harness.runService.start(version, "oi");

      await eventually(() => expect(eventsOf(run.id, "AgentFailed")).toHaveLength(1));

      expect(eventsOf(run.id, "GuardTripped")[0]).toMatchObject({
        agent: "Alfa",
        payload: { guard: "agent_budget", scope: "agent", budgetUsd: 0.05 },
      });
      expect(eventsOf(run.id, "AgentFailed")[0]).toMatchObject({
        agent: "Alfa",
        payload: { reason: expect.stringContaining("esgotou o orçamento") as string },
      });
      await eventually(() => expect(harness.runtimes.runtimeOf("Alfa")?.stopCount).toBe(1));
    });

    it("stops the run when its own budget is spent, adding all agents up", async () => {
      const harness = harnessWith({
        scripts: {
          Alfa: async (turn) => {
            await turn.send("Beta", "ajude");
            await turn.usage({ costUsd: 0.04 });
          },
          Beta: (turn) => turn.usage({ costUsd: 0.04 }),
        },
      });
      const run = await harness.runService.start(await publish(buildTestGraph()), "oi", {
        budgetUsd: 0.07,
      });

      await eventually(() => expect(finished(run.id)).toBeDefined());

      expect(finished(run.id)?.payload).toMatchObject({
        reason: "guard_tripped",
        guard: "run_budget",
      });
      expect(eventsOf(run.id, "GuardTripped")[0]?.payload).toMatchObject({
        budgetUsd: 0.07,
        spentUsd: 0.08,
      });
      expect(await statusOf(run.id)).toBe("failed");
    });

    it("does not end the run as quiet while the budget guard is still judging a usage report", async () => {
      // A slow database: the guard reads the log long after the agent went idle.
      const slow = {
        ...persistence.history,
        readFrom: persistence.history.readFrom.bind(persistence.history),
        readByType: async (runId: string, type: string) => {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return persistence.runLog.readByType(runId, type);
        },
      };
      persistence.history = slow;
      const harness = harnessWith({ scripts: { Alfa: (turn) => turn.usage({ costUsd: 0.5 }) } });
      const run = await harness.runService.start(await publish(buildTestGraph()), "oi", {
        budgetUsd: 0.2,
      });

      await eventually(() => expect(finished(run.id)).toBeDefined());

      expect(finished(run.id)?.payload).toMatchObject({
        reason: "guard_tripped",
        guard: "run_budget",
      });
    });

    it("applies the server's default budget to a run that sets none", async () => {
      const harness = harnessWith({
        scripts: { Alfa: (turn) => turn.usage({ costUsd: 0.5 }) },
        limits: { runBudgetUsd: 0.2 },
      });
      const run = await harness.runService.start(await publish(buildTestGraph()), "oi");

      await eventually(() => expect(finished(run.id)).toBeDefined());

      expect(finished(run.id)?.payload).toMatchObject({ guard: "run_budget" });
      expect(run.budgetUsd).toBe(0.2);
    });

    it("never counts an unknown cost as zero: it is recorded as unknown and warned about once", async () => {
      const harness = harnessWith({
        scripts: {
          Alfa: async (turn) => {
            await turn.usageWithoutCost();
            await turn.usageWithoutCost();
          },
        },
      });
      const version = await publish(graphWith({ Alfa: { budgetUsd: 1 } }));
      const run = await harness.runService.start(version, "oi");

      await eventually(() => expect(finished(run.id)).toBeDefined());

      expect(eventsOf(run.id, "UsageRecorded").map((event) => event.payload)).toEqual([
        expect.objectContaining({ costUsd: null }),
        expect.objectContaining({ costUsd: null }),
      ]);
      expect(eventsOf(run.id, "GuardWarning")).toHaveLength(1);
      expect(eventsOf(run.id, "GuardWarning")[0]).toMatchObject({
        agent: "Alfa",
        payload: { guard: "agent_budget", code: "cost_unknown" },
      });
      expect(eventsOf(run.id, "GuardTripped")).toEqual([]);
    });

    it("warns at the start that a runtime which reports no cost cannot be held to a budget", async () => {
      const harness = harnessWith({ runtimeOptions: { Alfa: { reportsCost: false } } });
      const version = await publish(graphWith({ Alfa: { budgetUsd: 1 } }));
      const run = await harness.runService.start(version, "oi");

      await eventually(() => expect(eventsOf(run.id, "GuardWarning")).toHaveLength(1));

      expect(eventsOf(run.id, "GuardWarning")[0]?.payload).toMatchObject({
        code: "runtime_without_cost",
      });
    });

    it("does not warn when no budget is at stake", async () => {
      const harness = harnessWith({ runtimeOptions: { Alfa: { reportsCost: false } } });
      const run = await harness.runService.start(await publish(buildTestGraph()), "oi");

      await eventually(() => expect(finished(run.id)).toBeDefined());

      expect(eventsOf(run.id, "GuardWarning")).toEqual([]);
    });

    it("records the usage of a turn that ends while the run is closing, before RunFinished", async () => {
      const harness = harnessWith({
        scripts: { Alfa: (turn) => turn.finish("pronto") },
        runtimeOptions: { Alfa: { usageOnStop: 0.02 } },
      });
      const run = await harness.runService.start(await publish(buildTestGraph()), "oi");

      await eventually(() => expect(finished(run.id)).toBeDefined());

      const usage = eventsOf(run.id, "UsageRecorded");
      expect(usage).toHaveLength(1);
      expect(usage[0]?.payload).toMatchObject({ costUsd: 0.02 });
      expect(usage[0]!.seq).toBeLessThan(finished(run.id)!.seq);
    });
  });

  describe("idle timeout", () => {
    const idleGraph = (seconds: number) => graphWith({ Alfa: { idleTimeoutSec: seconds } });

    /** Lets the in-memory plumbing (promises) run without moving the fake clock. */
    const settle = () => vi.advanceTimersByTimeAsync(0);

    it("stops an agent that stays busy too long without a sign of life", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const harness = harnessWith({ scripts: { Alfa: (turn) => turn.work(600_000) } });
      const run = await harness.runService.start(await publish(idleGraph(5)), "oi");
      await settle();
      expect(harness.runtimes.runtimeOf("Alfa")?.state).toBe("busy");

      await vi.advanceTimersByTimeAsync(4_900);
      expect(eventsOf(run.id, "GuardTripped")).toEqual([]);
      await vi.advanceTimersByTimeAsync(200);

      expect(eventsOf(run.id, "GuardTripped")[0]).toMatchObject({
        agent: "Alfa",
        payload: { guard: "idle_timeout", scope: "agent", idleTimeoutSec: 5 },
      });
      expect(eventsOf(run.id, "AgentFailed")[0]).toMatchObject({
        agent: "Alfa",
        payload: { reason: expect.stringContaining("5 s") as string },
      });
      expect(harness.runtimes.runtimeOf("Alfa")?.stopCount).toBe(1);
    });

    it("starts the time over every time the agent shows it is alive", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const harness = harnessWith({
        scripts: {
          Alfa: async (turn) => {
            await turn.work(4_000);
            await turn.peers();
            await turn.work(4_000);
            await turn.peers();
            await turn.work(600_000);
          },
        },
      });
      const run = await harness.runService.start(await publish(idleGraph(5)), "oi");
      await settle();

      await vi.advanceTimersByTimeAsync(8_500);
      expect(eventsOf(run.id, "GuardTripped")).toEqual([]);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(eventsOf(run.id, "GuardTripped")).toHaveLength(1);
    });

    it("does not count the time an agent waits for the answer to its own ask", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const harness = harnessWith({
        scripts: {
          Alfa: (turn) => turn.ask("Beta", "e aí?", { timeoutMs: 600_000 }).then(() => undefined),
          Beta: (turn) => turn.work(600_000),
        },
      });
      const run = await harness.runService.start(await publish(idleGraph(5)), "oi");
      await settle();
      expect(harness.runtimes.runtimeOf("Alfa")?.state).toBe("waiting_reply");

      await vi.advanceTimersByTimeAsync(60_000);

      expect(eventsOf(run.id, "GuardTripped")).toEqual([]);
    });

    it("leaves agents without idleTimeoutSec alone", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const harness = harnessWith({ scripts: { Alfa: (turn) => turn.work(100_000) } });
      const run = await harness.runService.start(await publish(buildTestGraph()), "oi");
      await settle();

      await vi.advanceTimersByTimeAsync(50_000);

      expect(eventsOf(run.id, "GuardTripped")).toEqual([]);
    });
  });
});
