import type {
  AgentCommunication,
  AgentRuntime,
  AgentRuntimeFactory,
  AgentRuntimeState,
  InboundMessage,
} from "@neurons/agent-runtimes";
import { Signal } from "@neurons/agent-runtimes";
import type { AgentNode } from "@neurons/graph-schema";
import {
  PROTOCOL_REVISION,
  PROTOCOL_VERSION,
  createMemoryChannelPair,
  type RunnerFrame,
  type ServerChannel,
  type ServerFrame,
} from "@neurons/runner-protocol";
import { describe, expect, it, vi } from "vitest";
import { RunnerHost } from "./runner-host.js";

class StubRuntime implements AgentRuntime {
  readonly reportsCost = false;
  readonly delivered: InboundMessage[] = [];
  state: AgentRuntimeState = "starting";
  stopCount = 0;
  private readonly changes = new Signal<AgentRuntimeState>();

  constructor(readonly communication: AgentCommunication) {}

  onStateChange(listener: (state: AgentRuntimeState) => void) {
    return this.changes.subscribe(listener);
  }

  start(): Promise<void> {
    this.set("idle");
    return Promise.resolve();
  }

  deliver(message: InboundMessage): Promise<void> {
    this.delivered.push(message);
    this.set("busy");
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.stopCount++;
    this.set("stopped");
    return Promise.resolve();
  }

  set(state: AgentRuntimeState): void {
    this.state = state;
    this.changes.emit(state);
  }
}

const agent: AgentNode = {
  id: "agente-alfa",
  type: "agent",
  position: { x: 0, y: 0 },
  name: "Alfa",
  role: "Papel",
  instructions: "Instruções.",
  effort: "low",
  runtime: { kind: "terminal", cli: "claude", mode: "stream-json", args: [], cwd: "/projeto" },
};

/** A server frame without its envelope (`v`), keeping the union so each `type` checks its own fields. */
type ServerBody = ServerFrame extends infer Frame
  ? Frame extends ServerFrame
    ? Omit<Frame, "v">
    : never
  : never;

/** A host plus the server end of its channel, where the test plays the server. */
function rig() {
  const runtimes: StubRuntime[] = [];
  const factory: AgentRuntimeFactory = {
    create: (_agent, communication) => {
      const runtime = new StubRuntime(communication);
      runtimes.push(runtime);
      return runtime;
    },
  };
  const host = new RunnerHost({ name: "teste", createFactory: () => factory });
  const received: RunnerFrame[] = [];
  let server!: ServerChannel;

  const connect = () => {
    const pair = createMemoryChannelPair();
    server = pair.server;
    server.onFrame((frame) => received.push(frame));
    host.attach(pair.runner);
  };
  const say = (frame: ServerBody) => server.send({ v: PROTOCOL_VERSION, ...frame });
  const next = async <T extends RunnerFrame["type"]>(type: T) => {
    await vi.waitFor(() => expect(received.some((frame) => frame.type === type)).toBe(true));
    return received.find((frame) => frame.type === type) as Extract<RunnerFrame, { type: T }>;
  };
  const count = (type: RunnerFrame["type"]) =>
    received.filter((frame) => frame.type === type).length;
  const start = async (instanceId: string) => {
    say({
      type: "agent.start",
      requestId: `start-${instanceId}`,
      instanceId,
      agent,
      briefing: "b",
      settings: { askTimeoutMs: 1000, usageFlushMs: 0 },
    });
    await vi.waitFor(() =>
      expect(received).toContainEqual(
        expect.objectContaining({ type: "response", requestId: `start-${instanceId}`, ok: true }),
      ),
    );
  };
  return { host, runtimes, received, connect, say, next, count, start, server: () => server };
}

const message = (id: string): InboundMessage => ({
  id,
  from: "@human",
  kind: "message",
  body: id,
  replyTo: null,
});

describe("RunnerHost", () => {
  it("opens every connection with register, listing the agents it still hosts", async () => {
    const r = rig();
    r.connect();
    expect((await r.next("register")).agents).toEqual([]);
    r.say({ type: "registered", runnerId: "r1", heartbeatIntervalMs: 60_000, keep: [] });
    await r.start("i1");

    r.host.detach();
    r.connect();

    await vi.waitFor(() => expect(r.count("register")).toBe(2));
    const second = r.received.filter((frame) => frame.type === "register")[1];
    expect(second).toMatchObject({ agents: [{ instanceId: "i1", state: "idle" }] });
    r.host.detach();
  });

  it("starts an agent once even when the server repeats the request", async () => {
    const r = rig();
    r.connect();
    r.say({ type: "registered", runnerId: "r1", heartbeatIntervalMs: 60_000, keep: [] });

    await r.start("i1");
    r.say({
      type: "agent.start",
      requestId: "again",
      instanceId: "i1",
      agent,
      briefing: "b",
      settings: { askTimeoutMs: 1000, usageFlushMs: 0 },
    });

    await vi.waitFor(() =>
      expect(r.received).toContainEqual(
        expect.objectContaining({ type: "response", requestId: "again", ok: true }),
      ),
    );
    expect(r.runtimes).toHaveLength(1);
    r.host.detach();
  });

  it("hands a message to the agent once, however many times the server repeats the delivery", async () => {
    const r = rig();
    r.connect();
    r.say({ type: "registered", runnerId: "r1", heartbeatIntervalMs: 60_000, keep: [] });
    await r.start("i1");

    for (const requestId of ["d1", "d2", "d3"]) {
      r.say({ type: "agent.deliver", requestId, instanceId: "i1", message: message("m1") });
    }

    await vi.waitFor(() => expect(r.count("response")).toBe(4));
    expect(r.runtimes[0]?.delivered).toHaveLength(1);
    expect(r.received.filter((f) => f.type === "response").every((f) => f.ok)).toBe(true);
    r.host.detach();
  });

  it("answers a request the runtime refuses with the reason, not with silence", async () => {
    const r = rig();
    r.connect();
    r.say({ type: "registered", runnerId: "r1", heartbeatIntervalMs: 60_000, keep: [] });

    r.say({
      type: "agent.deliver",
      requestId: "d1",
      instanceId: "nao-existe",
      message: message("m1"),
    });

    await vi.waitFor(() =>
      expect(r.received).toContainEqual(
        expect.objectContaining({ type: "response", requestId: "d1", ok: false }),
      ),
    );
    r.host.detach();
  });

  it("reports the agent's state changes", async () => {
    const r = rig();
    r.connect();
    r.say({ type: "registered", runnerId: "r1", heartbeatIntervalMs: 60_000, keep: [] });
    await r.start("i1");

    r.runtimes[0]?.set("busy");
    r.runtimes[0]?.set("idle");

    await vi.waitFor(() =>
      expect(
        r.received
          .filter((f) => f.type === "agent.state")
          .map((f) => (f as { state: string }).state),
      ).toEqual(["idle", "busy", "idle"]),
    );
    r.host.detach();
  });

  it("keeps a call waiting across connections and repeats it on the next one", async () => {
    const r = rig();
    r.connect();
    r.say({ type: "registered", runnerId: "r1", heartbeatIntervalMs: 60_000, keep: [] });
    await r.start("i1");
    const answer = r.runtimes[0]!.communication.sendMessage("Beta", "oi");
    await r.next("call");

    r.host.detach();
    r.connect();
    r.say({ type: "registered", runnerId: "r1", heartbeatIntervalMs: 60_000, keep: ["i1"] });

    await vi.waitFor(() => expect(r.count("call")).toBe(2));
    const callId = (r.received.find((f) => f.type === "call") as { callId: string }).callId;
    r.say({ type: "call.result", callId, ok: true, result: { messageId: "m9" } });
    await expect(answer).resolves.toEqual({ messageId: "m9" });
    r.host.detach();
  });

  it("turns a failed call into an error for the agent", async () => {
    const r = rig();
    r.connect();
    r.say({ type: "registered", runnerId: "r1", heartbeatIntervalMs: 60_000, keep: [] });
    await r.start("i1");
    const answer = r.runtimes[0]!.communication.ask("Beta", "?");
    const call = await r.next("call");

    r.say({ type: "call.result", callId: call.callId, ok: false, error: { message: "sem seta" } });

    await expect(answer).rejects.toThrow("sem seta");
    r.host.detach();
  });

  it("stops the agents the server does not keep", async () => {
    const r = rig();
    r.connect();
    r.say({ type: "registered", runnerId: "r1", heartbeatIntervalMs: 60_000, keep: [] });
    await r.start("i1");
    await r.start("i2");

    r.host.detach();
    r.connect();
    r.say({ type: "registered", runnerId: "r1", heartbeatIntervalMs: 60_000, keep: ["i2"] });

    await vi.waitFor(() => expect(r.runtimes[0]?.stopCount).toBe(1));
    expect(r.runtimes[1]?.stopCount).toBe(0);
    r.host.detach();
  });

  it("tells whoever listens that the server refused it", async () => {
    const r = rig();
    const refused = vi.fn();
    r.host.onRejected(refused);
    r.connect();

    r.say({ type: "reject", code: "unauthorized", message: "Token revogado." });

    await vi.waitFor(() => expect(refused).toHaveBeenCalledTimes(1));
    expect(refused.mock.calls[0]?.[0]).toMatchObject({ code: "unauthorized" });
  });

  it("closes a connection to a server that goes silent", async () => {
    const r = rig();
    r.connect();
    const closed = new Promise<number>((resolve) =>
      r.server().onClose((info) => resolve(info.code)),
    );

    r.say({ type: "registered", runnerId: "r1", heartbeatIntervalMs: 15, keep: [] });

    await expect(closed).resolves.toBe(4408);
  });
});

const report = { tool: "consulta_crm", inputSummary: "{}", durationMs: 12.4, ok: true };

describe("RunnerHost: protocol revisions", () => {
  it("announces its revision in register", async () => {
    const r = rig();
    r.connect();

    expect(await r.next("register")).toMatchObject({ revision: PROTOCOL_REVISION });
    r.host.detach();
  });

  it("reports a tool call to a server that announced revision 2", async () => {
    const r = rig();
    r.connect();
    r.say({
      type: "registered",
      runnerId: "r1",
      revision: PROTOCOL_REVISION,
      heartbeatIntervalMs: 60_000,
      keep: [],
    });
    await r.start("i1");

    void r.runtimes[0]?.communication.reportToolCall(report);

    const call = await r.next("call");
    expect(call).toMatchObject({
      instanceId: "i1",
      call: {
        method: "report_tool_call",
        report: { tool: "consulta_crm", inputSummary: "{}", durationMs: 12, ok: true },
      },
    });
    r.host.detach();
  });

  it("does not send it to a server that predates the call, which would drop the connection", async () => {
    const r = rig();
    r.connect();
    // No `revision`: a server from before revisions existed.
    r.say({ type: "registered", runnerId: "r1", heartbeatIntervalMs: 60_000, keep: [] });
    await r.start("i1");

    await expect(r.runtimes[0]?.communication.reportToolCall(report)).resolves.toBeUndefined();

    expect(r.count("call")).toBe(0);
    r.host.detach();
  });

  it("forgets the revision of a connection when the next one is made", async () => {
    const r = rig();
    r.connect();
    r.say({
      type: "registered",
      runnerId: "r1",
      revision: PROTOCOL_REVISION,
      heartbeatIntervalMs: 60_000,
      keep: [],
    });
    await r.start("i1");
    r.host.detach();
    r.connect(); // the new connection has not said what it speaks yet

    await r.runtimes[0]?.communication.reportToolCall(report);

    expect(r.count("call")).toBe(0);
    r.host.detach();
  });
});
