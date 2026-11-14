import { Logger } from "@nestjs/common";
import type { FakeTerminalRuntime } from "../agents/testing/fake-agent-runtime.js";
import { TerminalUnavailableError } from "../realtime/terminal-errors.js";
import type { EphemeralRunEvent, EventSink, RunEvent } from "../realtime/run-event.js";
import {
  PROTOCOL_REVISION,
  PROTOCOL_VERSION,
  createMemoryChannelPair,
} from "@neurons/runner-protocol";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HUMAN } from "../hub/addresses.js";
import { delay, eventually } from "../hub/testing/async-helpers.js";
import { createHubWiring, inMemoryPersistence } from "../hub/testing/hub-harness.js";
import { RemoteAgentRuntime } from "./remote-agent-runtime.js";
import { createRunnerRig } from "./testing/runner-rig.js";

let persistence: ReturnType<typeof inMemoryPersistence>;
let rig: ReturnType<typeof createRunnerRig>;

beforeAll(() => {
  Logger.overrideLogger(false);
});

beforeEach(() => {
  persistence = inMemoryPersistence();
});

afterEach(() => {
  rig.dispose();
});

/** The Hub and Supervisor of the server, with every agent living in the rig's runner. */
function start(options: Parameters<typeof createRunnerRig>[0] = {}) {
  rig = createRunnerRig(options);
  rig.connect();
  return createHubWiring(persistence, rig.factory);
}

const received = (agent: string): string[] =>
  rig.fakes.runtimeOf(agent)?.received.map((message) => message.body) ?? [];

describe("agents hosted by a runner", () => {
  it("talk through the Hub as if they were in the same process: ask, reply and the answer back", async () => {
    let answer = "";
    const wiring = start({
      scripts: {
        Alfa: async (turn) => {
          answer = await turn.ask("Beta", "tudo bem?");
        },
        Beta: async (turn) => {
          await turn.reply("sim");
        },
      },
    });
    const runId = await wiring.openRun();

    await wiring.hub.send(runId, HUMAN, "Alfa", "message", "comece");

    await eventually(() => expect(answer).toBe("sim"));
    expect(rig.fakes.runtimeOf("Beta")?.received).toMatchObject([
      { from: "Alfa", kind: "ask", body: "tudo bem?" },
    ]);
    await eventually(() =>
      expect(persistence.messageStore.allOf(runId).every((message) => message.ackedAt)).toBe(true),
    );
  });

  it("mirror the state the runner reports, and the Hub only hands over the next message when they are idle", async () => {
    const wiring = start({ scripts: { Beta: (turn) => turn.work(80) } });
    const runId = await wiring.openRun();

    for (const body of ["a", "b", "c"]) {
      await wiring.hub.send(runId, HUMAN, "Beta", "message", body);
    }

    await eventually(() => expect(received("Beta")).toEqual(["a", "b", "c"]));
  });

  it("carry the usage of a turn to the run log, with the cost the runner measured", async () => {
    const wiring = start({
      scripts: { Beta: (turn) => turn.usage({ costUsd: 0.0123, inputTokens: 7 }) },
    });
    const runId = await wiring.openRun();

    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");

    await eventually(() =>
      expect(persistence.runLog.eventsOf(runId, "UsageRecorded")).toMatchObject([
        { agent: "Beta", payload: { costUsd: 0.0123, inputTokens: 7 } },
      ]),
    );
  });

  it("carry an error of the Hub back to the agent that called it", async () => {
    let failure = "";
    const wiring = start({
      scripts: {
        Alfa: async (turn) => {
          try {
            await turn.send("Delta", "não tenho seta para Delta");
          } catch (error) {
            failure = (error as Error).message;
          }
        },
      },
    });
    const runId = await wiring.openRun();

    await wiring.hub.send(runId, HUMAN, "Alfa", "message", "tente");

    await eventually(() => expect(failure).toContain("Delta"));
  });

  it("stop with the run: the runner stops the agent and the server forgets it", async () => {
    const wiring = start();
    const runId = await wiring.openRun();
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() => expect(received("Beta")).toEqual(["oi"]));

    await wiring.supervisor.stopRun(runId);

    expect(rig.fakes.runtimeOf("Beta")?.stopCount).toBe(1);
    expect(rig.fakes.runtimeOf("Beta")?.state).toBe("stopped");
    expect(rig.link?.load).toBe(0);
  });

  it("report the last usage of a turn that ends while the agent is stopped", async () => {
    const wiring = start({ runtimeOptions: { Beta: { usageOnStop: 0.5 } } });
    const runId = await wiring.openRun();
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() => expect(received("Beta")).toEqual(["oi"]));

    await wiring.supervisor.stopRun(runId);

    expect(persistence.runLog.eventsOf(runId, "UsageRecorded")).toMatchObject([
      { agent: "Beta", payload: { costUsd: 0.5 } },
    ]);
  });
});

describe("when the connection to the runner drops", () => {
  it("delivers what piled up while the agent was away, once and in order", async () => {
    const wiring = start({ scripts: { Beta: (turn) => turn.work(120) } });
    const runId = await wiring.openRun();
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "m1");
    await eventually(() => expect(received("Beta")).toEqual(["m1"]));

    rig.sever();
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "m2");
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "m3");
    // The agent finishes m1 while nobody is listening: its `idle` is lost with the connection.
    await delay(250);
    expect(received("Beta")).toEqual(["m1"]);

    rig.connect();

    await eventually(() => expect(received("Beta")).toEqual(["m1", "m2", "m3"]));
    await eventually(() =>
      expect(persistence.messageStore.allOf(runId).every((message) => message.ackedAt)).toBe(true),
    );
  });

  it("delivers a message sent to an idle agent while the runner was away", async () => {
    const wiring = start();
    const runId = await wiring.openRun();
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "antes");
    await eventually(() => expect(received("Beta")).toEqual(["antes"]));

    rig.sever();
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "durante");
    await delay(50);
    expect(received("Beta")).toEqual(["antes"]);

    rig.connect();

    await eventually(() => expect(received("Beta")).toEqual(["antes", "durante"]));
    await eventually(() =>
      expect(persistence.messageStore.allOf(runId).every((message) => message.ackedAt)).toBe(true),
    );
  });

  it("completes a tool call the agent made while disconnected, exactly once", async () => {
    const wiring = start({
      scripts: {
        Alfa: async (turn) => {
          await turn.work(100);
          await turn.send("Beta", "enviada durante a queda");
        },
      },
    });
    const runId = await wiring.openRun();
    await wiring.hub.send(runId, HUMAN, "Alfa", "message", "vá");
    await eventually(() => expect(received("Alfa")).toEqual(["vá"]));

    rig.sever();
    await delay(250);
    expect(received("Beta")).toEqual([]);

    rig.connect();

    await eventually(() => expect(received("Beta")).toEqual(["enviada durante a queda"]));
    const fromAlfa = persistence.messageStore.allOf(runId).filter((m) => m.from === "Alfa");
    expect(fromAlfa).toHaveLength(1);
  });

  it("keeps an ask open across the drop and answers it when the runner is back", async () => {
    let answer = "";
    const wiring = start({
      scripts: {
        Alfa: async (turn) => {
          answer = await turn.ask("Beta", "responde depois?");
        },
        Beta: async (turn) => {
          await turn.reply("respondi");
        },
      },
    });
    const runId = await wiring.openRun();
    await wiring.hub.send(runId, HUMAN, "Alfa", "message", "pergunte");
    await eventually(() => expect(received("Beta")).toEqual(["responde depois?"]));

    // The answer is on its way back when the connection falls.
    rig.sever();
    await delay(100);
    rig.connect();

    await eventually(() => expect(answer).toBe("respondi"));
  });

  it("fails the agents only after the grace period, with the reason in the log", async () => {
    const wiring = start({ runners: { graceMs: 80 } });
    const runId = await wiring.openRun();
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() => expect(received("Beta")).toEqual(["oi"]));

    rig.sever();
    await delay(30);
    expect(persistence.runLog.eventsOf(runId, "AgentFailed")).toEqual([]);

    await eventually(() =>
      expect(persistence.runLog.eventsOf(runId, "AgentFailed")).toMatchObject([
        { agent: "Beta", payload: { reason: expect.stringContaining("não voltou") as string } },
      ]),
    );
  });

  it("fails an agent the restarted runner no longer has", async () => {
    const wiring = start();
    const runId = await wiring.openRun();
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() => expect(received("Beta")).toEqual(["oi"]));

    rig.sever();
    rig.restartRunner();
    rig.connect();

    await eventually(() =>
      expect(persistence.runLog.eventsOf(runId, "AgentFailed")).toMatchObject([
        {
          agent: "Beta",
          payload: { reason: expect.stringContaining("perdeu o agente") as string },
        },
      ]),
    );
  });

  it("makes the runner stop the agents of a run the server no longer knows", async () => {
    const wiring = start();
    const runId = await wiring.openRun();
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() => expect(received("Beta")).toEqual(["oi"]));

    // The server restarted: it has a registry that never heard of this agent.
    rig.sever();
    const restartedServer = createRunnerRig();
    const { server, runner } = createMemoryChannelPair();
    restartedServer.registry.accept(rig.identity, server);
    rig.host.attach(runner);

    await eventually(() => expect(rig.fakes.runtimeOf("Beta")?.stopCount).toBe(1));
    restartedServer.dispose();
  });
});

describe("choosing the runner", () => {
  it("waits for a runner to connect when none is there yet", async () => {
    rig = createRunnerRig({ runners: { waitMs: 2_000 } });
    const wiring = createHubWiring(persistence, rig.factory);
    const runId = await wiring.openRun();

    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await delay(50);
    expect(received("Beta")).toEqual([]);
    rig.connect();

    await eventually(() => expect(received("Beta")).toEqual(["oi"]));
  });

  it("fails the agent with a message for the user when no runner shows up in time", async () => {
    rig = createRunnerRig({ runners: { waitMs: 30 } });
    const wiring = createHubWiring(persistence, rig.factory);
    const runId = await wiring.openRun();

    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");

    await eventually(() =>
      expect(persistence.runLog.eventsOf(runId, "AgentFailed")).toMatchObject([
        { agent: "Beta", payload: { reason: expect.stringContaining("Nenhum runner") as string } },
      ]),
    );
  });
});

describe("the link to a runner", () => {
  it("answers a call the runner repeats with the first outcome, without running it twice", async () => {
    rig = createRunnerRig();
    const sent: string[] = [];
    const communication = {
      sendMessage: (_to: string, text: string) => {
        sent.push(text);
        return Promise.resolve({ messageId: `m${sent.length}` });
      },
    } as never;

    // A bare protocol conversation: the test plays the runner.
    const { server, runner } = createMemoryChannelPair();
    const frames: { type: string; callId?: string; result?: unknown }[] = [];
    runner.onFrame((frame) => frames.push(frame));
    rig.registry.accept(rig.identity, server);
    runner.send({
      v: PROTOCOL_VERSION,
      type: "register",
      runner: { name: "teste" },
      capabilities: { terminal: true, streamJson: true },
      agents: [],
    });
    await eventually(() => expect(rig.link?.connected).toBe(true));
    const runtime = new RemoteAgentRuntime(
      { name: "Alfa", runtime: { kind: "api" } } as never,
      communication,
      rig.registry,
      { settings: { askTimeoutMs: 1000, usageFlushMs: 0 }, stopWaitMs: 100 },
    );
    rig.link?.bind(runtime);

    const call = {
      v: PROTOCOL_VERSION as 1,
      type: "call" as const,
      callId: "c-1",
      instanceId: runtime.instanceId,
      call: { method: "send_message" as const, to: "Beta", text: "uma vez só" },
    };
    runner.send(call);
    runner.send(call);

    await eventually(() => expect(frames.filter((f) => f.type === "call.result")).toHaveLength(2));
    expect(sent).toEqual(["uma vez só"]);
    const [first, second] = frames.filter((f) => f.type === "call.result");
    expect(first).toEqual(second);
    expect(first?.result).toEqual({ messageId: "m1" });
  });

  it("closes a connection that stops sending frames", async () => {
    rig = createRunnerRig({ runners: { heartbeatMs: 20 } });
    const { server, runner } = createMemoryChannelPair();
    rig.registry.accept(rig.identity, server);
    runner.send({
      v: PROTOCOL_VERSION,
      type: "register",
      runner: { name: "mudo" },
      capabilities: { terminal: true, streamJson: true },
      agents: [],
    });
    const closed = new Promise<number>((resolve) => runner.onClose((info) => resolve(info.code)));

    await expect(closed).resolves.toBe(4408);
  });
});

describe("what the dashboard shows, through the protocol", () => {
  const statesOf = (runId: string, agent: string): string[] =>
    persistence.runLog
      .eventsOf(runId, "AgentStateChanged")
      .filter((event) => event.agent === agent)
      .map((event) => (event.payload as { state: string }).state);

  it("writes ToolCalled for a tool the agent used in the runner, with the summary it sent", async () => {
    const wiring = start({
      scripts: {
        Beta: (turn) =>
          turn.toolCall({
            tool: "consulta_crm",
            inputSummary: '{"token":"[oculto]","id":"{{secret:CRM}}"}',
            durationMs: 31,
            ok: false,
            errorCode: "HTTP_ERROR",
          }),
      },
    });
    const runId = await wiring.openRun();

    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");

    await eventually(() =>
      expect(persistence.runLog.eventsOf(runId, "ToolCalled")).toMatchObject([
        {
          agent: "Beta",
          payload: {
            tool: "consulta_crm",
            inputSummary: '{"token":"[oculto]","id":"{{secret:CRM}}"}',
            durationMs: 31,
            ok: false,
            errorCode: "HTTP_ERROR",
          },
        },
      ]),
    );
  });

  it("writes the states the runner reports, once each, and finished when the run stops", async () => {
    const wiring = start({ scripts: { Beta: (turn) => turn.work(20) } });
    const runId = await wiring.openRun();

    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() =>
      expect(statesOf(runId, "Beta")).toEqual(["starting", "idle", "busy", "idle"]),
    );
    await wiring.supervisor.stopRun(runId);

    expect(statesOf(runId, "Beta")).toEqual(["starting", "idle", "busy", "idle", "finished"]);
  });

  it("tells waiting_reply for an ask made from the runner, and busy again once it is answered", async () => {
    const wiring = start({
      scripts: {
        Alfa: async (turn) => void (await turn.ask("Beta", "tudo bem?")),
        Beta: async (turn) => {
          await turn.work(40);
          await turn.reply("sim");
        },
      },
    });
    const runId = await wiring.openRun();

    await wiring.hub.send(runId, HUMAN, "Alfa", "message", "comece");

    await eventually(() =>
      expect(statesOf(runId, "Alfa")).toEqual([
        "starting",
        "idle",
        "busy",
        "waiting_reply",
        "busy",
        "idle",
      ]),
    );
  });

  it("keeps the latest terminal output of an agent in the runner for a client that connects late, never cutting a chunk", async () => {
    const wiring = start({ runtimeOptions: { Beta: { terminal: true } } });
    const runId = await wiring.openRun();
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() => expect(received("Beta")).toEqual(["oi"]));
    const terminal = rig.fakes.runtimeOf("Beta") as FakeTerminalRuntime;
    const session = (): string => {
      const seen: string[] = [];
      wiring.terminals.replayTo(
        {
          send: () => undefined,
          sendEphemeral: (event) => {
            if (event.type === "TerminalOutput") seen.push(event.data);
          },
        },
        runId,
      );
      return seen.join("");
    };

    terminal.print("a".repeat(100_000));
    terminal.print("b".repeat(100_000));
    terminal.print("c".repeat(100_000));

    await eventually(() => expect(session()).toBe("b".repeat(100_000) + "c".repeat(100_000)));
  });

  it("types into the terminal of an agent in the runner, and says so when the connection is down", async () => {
    const wiring = start({ runtimeOptions: { Beta: { terminal: true } } });
    const runId = await wiring.openRun();
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() => expect(received("Beta")).toEqual(["oi"]));
    const terminal = rig.fakes.runtimeOf("Beta") as FakeTerminalRuntime;

    wiring.terminals.writeInput(runId, "Beta", "ls\r");
    await eventually(() => expect(terminal.typed).toEqual(["ls\r"]));

    rig.sever();
    await eventually(() => expect(rig.link?.connected).toBe(false));
    expect(() => wiring.terminals.writeInput(runId, "Beta", "perdido")).toThrow(
      TerminalUnavailableError,
    );
    expect(terminal.typed).toEqual(["ls\r"]);
  });

  it("resizes the terminal in the runner, and the server's replay restarts there, laid out for the new size", async () => {
    const wiring = start({ runtimeOptions: { Beta: { terminal: true } } });
    const runId = await wiring.openRun();
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() => expect(received("Beta")).toEqual(["oi"]));
    const terminal = rig.fakes.runtimeOf("Beta") as FakeTerminalRuntime;
    terminal.print("tela do tamanho antigo");
    const live: string[] = [];
    await wiring.subscriptions.subscribe(
      {
        send: () => undefined,
        sendEphemeral: (event) => {
          if (event.type === "TerminalResized") live.push(`${event.cols}x${event.rows}`);
        },
      },
      runId,
    );

    wiring.terminals.reportSize({}, runId, "Beta", 100, 30);

    await eventually(() => expect(terminal.resized).toEqual([{ cols: 100, rows: 30 }]));
    await eventually(() => expect(live).toEqual(["100x30"]));
    terminal.print("tela nova");
    const replays: unknown[] = [];
    await eventually(() => {
      replays.length = 0;
      wiring.terminals.replayTo(
        { send: () => undefined, sendEphemeral: (event) => void replays.push(event) },
        runId,
      );
      expect(replays).toMatchObject([
        { type: "TerminalOutput", data: "tela nova", replay: true, cols: 100, rows: 30 },
      ]);
    });
  });

  it("applies a resize asked while the runner was away once it is back, instead of losing it", async () => {
    const wiring = start({ runtimeOptions: { Beta: { terminal: true } } });
    const runId = await wiring.openRun();
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() => expect(received("Beta")).toEqual(["oi"]));
    const terminal = rig.fakes.runtimeOf("Beta") as FakeTerminalRuntime;

    rig.sever();
    await eventually(() => expect(rig.link?.connected).toBe(false));
    // The viewer narrows its window while the connection is down: the frame has nowhere to go.
    wiring.terminals.reportSize({}, runId, "Beta", 90, 25);
    expect(terminal.resized).toEqual([]);

    rig.connect();

    await eventually(() => expect(terminal.resized).toEqual([{ cols: 90, rows: 25 }]));
  });

  it("does not send the resize to a runner that predates revision 4, which would drop the connection", async () => {
    rig = createRunnerRig({ runtimeOptions: { Beta: { terminal: true } } });
    const { server, runner } = createMemoryChannelPair();
    const frames: { type: string }[] = [];
    runner.onFrame((frame) => {
      frames.push(frame);
      // The test plays an old runner: it answers the start and never announces a revision.
      if (frame.type === "agent.start") {
        runner.send({
          v: PROTOCOL_VERSION,
          type: "response",
          requestId: frame.requestId,
          ok: true,
        });
      }
    });
    rig.registry.accept(rig.identity, server);
    runner.send({
      v: PROTOCOL_VERSION,
      type: "register",
      runner: { name: "antigo" },
      capabilities: { terminal: true, streamJson: true },
      agents: [],
    });
    await eventually(() => expect(rig.link?.connected).toBe(true));
    const wiring = createHubWiring(persistence, rig.factory);
    const runId = await wiring.openRun();
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() => expect(frames.some((frame) => frame.type === "agent.start")).toBe(true));
    await eventually(() => expect(wiring.terminals.activeGraph(runId)).toBeDefined());

    wiring.terminals.reportSize({}, runId, "Beta", 100, 30);
    await delay(50);

    expect(frames.filter((frame) => frame.type === "agent.resize")).toEqual([]);
    expect(rig.link?.connected).toBe(true);
  });
});

describe("a runner of another protocol revision than the server's", () => {
  /** Plays a runner that announces `revision`, answers every start, and records what it receives. */
  async function connectRunnerOfRevision(revision: number, extra: Record<string, unknown> = {}) {
    rig = createRunnerRig({ runtimeOptions: { Beta: { terminal: true } } });
    const { server, runner } = createMemoryChannelPair();
    const frames: { type: string; revision?: number; instanceId?: string }[] = [];
    runner.onFrame((frame) => {
      frames.push(frame);
      if (frame.type === "agent.start") {
        runner.send({
          v: PROTOCOL_VERSION,
          type: "response",
          requestId: frame.requestId,
          ok: true,
        });
      }
    });
    rig.registry.accept(rig.identity, server);
    runner.send({
      v: PROTOCOL_VERSION,
      type: "register",
      runner: { name: `revisao-${revision}` },
      capabilities: { terminal: true, streamJson: true },
      agents: [],
      revision,
      ...extra,
    } as never);
    await eventually(() => expect(rig.link?.connected).toBe(true));
    const wiring = createHubWiring(persistence, rig.factory);
    const runId = await wiring.openRun();
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "oi");
    await eventually(() => expect(frames.some((frame) => frame.type === "agent.start")).toBe(true));
    await eventually(() => expect(wiring.terminals.activeGraph(runId)).toBeDefined());
    return { wiring, runId, frames, runner };
  }

  /** What a viewer of the run is sent live. */
  async function watch(wiring: ReturnType<typeof createHubWiring>, runId: string) {
    const live: EphemeralRunEvent[] = [];
    const sink: EventSink = {
      send: (_event: RunEvent) => undefined,
      sendEphemeral: (event) => void live.push(event),
    };
    await wiring.subscriptions.subscribe(sink, runId);
    return live;
  }

  const deltaFrame = {
    v: PROTOCOL_VERSION as 1,
    type: "agent.delta" as const,
    turnId: "t1",
    channel: "message" as const,
    delta: "Olá",
  };

  it("publishes the live text of a runner of revision 6 as AgentOutputDelta, never into the log", async () => {
    const { wiring, runId, runner, frames } = await connectRunnerOfRevision(PROTOCOL_REVISION);
    const live = await watch(wiring, runId);
    const betaId = frames.find((frame) => frame.type === "agent.start")!.instanceId!;

    runner.send({ ...deltaFrame, instanceId: betaId });

    await eventually(() =>
      expect(live).toMatchObject([
        { type: "AgentOutputDelta", agent: "Beta", turnId: "t1", channel: "message", delta: "Olá" },
      ]),
    );
    expect(rig.link?.connected).toBe(true);
  });

  it("works with a runner of revision 5, which never sends the live text", async () => {
    const { wiring, runId, frames } = await connectRunnerOfRevision(5);
    const live = await watch(wiring, runId);
    await wiring.hub.send(runId, HUMAN, "Beta", "message", "outra");
    await delay(50);

    expect(live).toEqual([]);
    expect(frames.some((frame) => frame.type === "agent.deliver")).toBe(true);
    expect(rig.link?.connected).toBe(true);
  });

  it("works with a runner of revision 4 (the one before this server): answers it with its own revision and sends the resize that revision knows", async () => {
    const { wiring, runId, frames } = await connectRunnerOfRevision(4);
    expect(frames.find((frame) => frame.type === "registered")?.revision).toBe(PROTOCOL_REVISION);
    expect(rig.link?.revision).toBe(4);

    wiring.terminals.reportSize({}, runId, "Beta", 100, 30);

    await eventually(() =>
      expect(frames.some((frame) => frame.type === "agent.resize")).toBe(true),
    );
    expect(rig.link?.connected).toBe(true);
  });

  it("works with a runner of a newer revision, ignoring what it adds, and uses only what both know", async () => {
    const { wiring, runId, frames } = await connectRunnerOfRevision(PROTOCOL_REVISION + 1, {
      campoDoFuturo: true,
    });
    expect(rig.link?.revision).toBe(PROTOCOL_REVISION + 1);

    wiring.terminals.reportSize({}, runId, "Beta", 100, 30);

    await eventually(() =>
      expect(frames.some((frame) => frame.type === "agent.resize")).toBe(true),
    );
    expect(rig.link?.connected).toBe(true);
  });
});
