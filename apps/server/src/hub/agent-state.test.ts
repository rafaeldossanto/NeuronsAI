import { beforeEach, describe, expect, it } from "vitest";
import { HUMAN } from "./addresses.js";
import { lifecycleStateOf } from "./agent-state.js";
import { eventually } from "./testing/async-helpers.js";
import { createHubHarness, inMemoryPersistence } from "./testing/hub-harness.js";

describe("lifecycleStateOf", () => {
  it("reads a working runtime as waiting_reply while any ask is open, and as busy otherwise", () => {
    expect(lifecycleStateOf("busy", 0)).toBe("busy");
    expect(lifecycleStateOf("busy", 1)).toBe("waiting_reply");
    expect(lifecycleStateOf("waiting_reply", 2)).toBe("waiting_reply");
    expect(lifecycleStateOf("waiting_reply", 0)).toBe("busy");
  });

  it("does not let an open ask make an idle agent look busy", () => {
    expect(lifecycleStateOf("idle", 1)).toBe("idle");
  });

  it("calls a stopped runtime finished and keeps the rest as they are", () => {
    expect(lifecycleStateOf("stopped", 0)).toBe("finished");
    expect(lifecycleStateOf("starting", 0)).toBe("starting");
    expect(lifecycleStateOf("failed", 0)).toBe("failed");
  });
});

describe("Supervisor: AgentStateChanged", () => {
  let persistence: ReturnType<typeof inMemoryPersistence>;

  beforeEach(() => {
    persistence = inMemoryPersistence();
  });

  /** The states the log tells about the agent, in order. */
  const statesOf = (runId: string, agent: string): string[] =>
    persistence.runLog
      .eventsOf(runId, "AgentStateChanged")
      .filter((event) => event.agent === agent)
      .map((event) => (event.payload as { state: string }).state);

  it("tells starting, idle, busy and idle again, each one once", async () => {
    const harness = createHubHarness(persistence, { scripts: { Beta: (turn) => turn.work(10) } });
    const runId = await harness.openRun();

    await harness.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() =>
      expect(statesOf(runId, "Beta")).toEqual(["starting", "idle", "busy", "idle"]),
    );
    await harness.hub.send(runId, HUMAN, "Beta", "message", "de novo");

    await eventually(() =>
      expect(statesOf(runId, "Beta")).toEqual(["starting", "idle", "busy", "idle", "busy", "idle"]),
    );
  });

  it("writes the first state right after AgentStarted, in the same stroke", async () => {
    const harness = createHubHarness(persistence);
    const runId = await harness.openRun();

    await harness.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() => expect(statesOf(runId, "Beta")).toContain("idle"));

    const [started] = persistence.runLog.eventsOf(runId, "AgentStarted");
    const [starting] = persistence.runLog.eventsOf(runId, "AgentStateChanged");
    expect(starting?.seq).toBe((started?.seq ?? 0) + 1);
    expect(starting?.payload).toEqual({ state: "starting" });
  });

  it("stays waiting_reply while any ask is open: with two, the first answer does not make the agent busy", async () => {
    const answers: Record<string, (text: string) => void> = {};
    const harness = createHubHarness(persistence, {
      scripts: {
        // Beta asks Gama twice at the same time and goes on only when both are answered.
        Beta: async (turn) => {
          if (turn.message.from === HUMAN) {
            await Promise.all([turn.ask("Gama", "um?"), turn.ask("Gama", "dois?")]);
          }
        },
        Gama: (turn) =>
          new Promise<void>((resolve) => {
            answers[turn.message.body] = (text) => void turn.reply(text).then(() => resolve());
          }),
      },
      hub: { askTimeoutMs: 60_000 },
    });
    const runId = await harness.openRun();

    await harness.hub.send(runId, HUMAN, "Beta", "message", "comece");
    // Gama takes the first ask; the second waits in its inbox until it is idle again.
    await eventually(() => expect(Object.keys(answers)).toEqual(["um?"]));
    expect(harness.hub.openAsksOf(runId, "Beta")).toBe(2);
    expect(statesOf(runId, "Beta").at(-1)).toBe("waiting_reply");

    answers["um?"]?.("a");
    await eventually(() => expect(Object.keys(answers)).toHaveLength(2));
    expect(harness.hub.openAsksOf(runId, "Beta")).toBe(1);
    // The fake runtime went back to busy by itself after the first answer; the log did not.
    expect(harness.runtimes.runtimeOf("Beta")?.state).toBe("busy");
    expect(statesOf(runId, "Beta").at(-1)).toBe("waiting_reply");
    expect(statesOf(runId, "Beta").filter((state) => state === "waiting_reply")).toHaveLength(1);

    answers["dois?"]?.("b");
    await eventually(() => expect(statesOf(runId, "Beta").slice(-2)).toEqual(["busy", "idle"]));
    expect(harness.hub.openAsksOf(runId, "Beta")).toBe(0);
  });

  it("goes back to busy when an ask times out", async () => {
    const harness = createHubHarness(persistence, {
      scripts: {
        Beta: async (turn) => {
          if (turn.message.from === HUMAN) {
            await turn.ask("Gama", "oi?", { timeoutMs: 40 }).catch(() => undefined);
          }
        },
        Gama: () => new Promise<void>(() => undefined),
      },
    });
    const runId = await harness.openRun();

    await harness.hub.send(runId, HUMAN, "Beta", "message", "comece");

    await eventually(() =>
      expect(statesOf(runId, "Beta")).toEqual([
        "starting",
        "idle",
        "busy",
        "waiting_reply",
        "busy",
        "idle",
      ]),
    );
  });

  it("tells failed once, with the reason, right after AgentFailed", async () => {
    const harness = createHubHarness(persistence, {
      scripts: {
        Beta: () => {
          throw new Error("quebrou no meio");
        },
      },
    });
    const runId = await harness.openRun();

    await harness.hub.send(runId, HUMAN, "Beta", "message", "oi");

    await eventually(() => expect(statesOf(runId, "Beta").at(-1)).toBe("failed"));
    const failed = persistence.runLog
      .eventsOf(runId, "AgentStateChanged")
      .filter((event) => (event.payload as { state: string }).state === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.payload).toEqual({ state: "failed", reason: "quebrou no meio" });
    const failure = persistence.runLog.eventsOf(runId, "AgentFailed")[0];
    expect(failed[0]?.seq).toBe((failure?.seq ?? 0) + 1);
  });

  it("tells failed when the runtime cannot even be created", async () => {
    const harness = createHubHarness(persistence);
    harness.runtimes.create = () => {
      throw new Error("runtime indisponível");
    };
    const runId = await harness.openRun();

    await harness.hub.send(runId, HUMAN, "Beta", "message", "oi");

    await eventually(() => expect(statesOf(runId, "Beta")).toEqual(["failed"]));
  });

  it("tells finished for the agents alive when the run stops, but not for one that had failed", async () => {
    const harness = createHubHarness(persistence, {
      scripts: {
        Gama: () => {
          throw new Error("caiu");
        },
      },
    });
    const runId = await harness.openRun();
    await harness.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await harness.hub.send(runId, HUMAN, "Gama", "message", "oi");
    await eventually(() => expect(statesOf(runId, "Gama").at(-1)).toBe("failed"));
    await eventually(() => expect(statesOf(runId, "Beta").at(-1)).toBe("idle"));

    await harness.supervisor.stopRun(runId);

    expect(statesOf(runId, "Beta").at(-1)).toBe("finished");
    expect(statesOf(runId, "Gama").filter((state) => state === "failed")).toHaveLength(1);
    expect(statesOf(runId, "Gama")).not.toContain("finished");
  });

  it("writes every state before RunFinished when the run is stopped", async () => {
    const harness = createHubHarness(persistence);
    const runId = await harness.openRun();
    await harness.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() => expect(statesOf(runId, "Beta").at(-1)).toBe("idle"));

    await harness.runService.stop(runId);

    const events = persistence.runLog.eventsOf(runId).sort((a, b) => a.seq - b.seq);
    const finishedAt = events.findIndex((event) => event.type === "RunFinished");
    const lastState = events.findLastIndex((event) => event.type === "AgentStateChanged");
    expect(finishedAt).toBeGreaterThan(-1);
    expect(lastState).toBeLessThan(finishedAt);
    expect(statesOf(runId, "Beta").at(-1)).toBe("finished");
  });

  it("takes the agent out as failed when a guard stops it, and does not repeat the state afterwards", async () => {
    const harness = createHubHarness(persistence);
    const runId = await harness.openRun();
    await harness.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() => expect(statesOf(runId, "Beta").at(-1)).toBe("idle"));

    await harness.supervisor.abortAgent(runId, "Beta", "Orçamento do agente esgotado.");
    await harness.supervisor.stopRun(runId);

    expect(statesOf(runId, "Beta").at(-1)).toBe("failed");
    expect(statesOf(runId, "Beta").filter((state) => state === "failed")).toHaveLength(1);
    expect(persistence.runLog.eventsOf(runId, "AgentStateChanged").at(-1)?.payload).toEqual({
      state: "failed",
      reason: "Orçamento do agente esgotado.",
    });
  });
});
