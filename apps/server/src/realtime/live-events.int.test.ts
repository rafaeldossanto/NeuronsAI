import type { AddressInfo } from "node:net";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import twoTerminals from "@neurons/graph-schema/examples/two-terminals.json" with { type: "json" };
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  FakeAgentRuntimeFactory,
  FakeTerminalRuntime,
  type FakeScript,
} from "../agents/testing/fake-agent-runtime.js";
import { startTestApi } from "../api/testing/test-api.js";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { deferred, eventually } from "../hub/testing/async-helpers.js";
import type { AppConfig } from "../shared/config/app-config.js";

/** The realtime endpoint (/ws) over the whole app: the new events and typing into a terminal. */

let testDb: TestDatabase;
let app: NestFastifyApplication | undefined;
let port: number;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  testDb = await startTestDatabase();
  Logger.overrideLogger(false);
});

afterAll(async () => {
  await testDb.stop();
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await app?.close();
  app = undefined;
});

async function startServer(
  scripts: Record<string, FakeScript>,
  config: Partial<AppConfig> = {},
): Promise<FakeAgentRuntimeFactory> {
  const fakes = new FakeAgentRuntimeFactory(scripts, {
    Pesquisador: { terminal: true },
    Revisor: {},
  });
  app = await startTestApi(testDb, { runtimes: fakes, config });
  await app.listen(0, "127.0.0.1");
  port = (app.getHttpServer().address() as AddressInfo).port;
  return fakes;
}

async function startRun(): Promise<string> {
  const graph = await app!.inject({ method: "POST", url: "/graphs", payload: { name: "Dois" } });
  const graphId = graph.json<{ id: string }>().id;
  const version = await app!.inject({
    method: "POST",
    url: `/graphs/${graphId}/versions`,
    payload: { definition: { ...twoTerminals, id: graphId } },
  });
  const run = await app!.inject({
    method: "POST",
    url: "/runs",
    payload: { graphVersionId: version.json<{ id: string }>().id, input: "comece" },
  });
  expect(run.statusCode).toBe(201);
  return run.json<{ id: string }>().id;
}

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

/** A client of /ws that keeps every frame it receives. */
async function connect(): Promise<{ socket: WebSocket; frames: Frame[] }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  sockets.push(socket);
  const frames: Frame[] = [];
  socket.on("message", (data) =>
    frames.push(JSON.parse((data as Buffer).toString("utf8")) as Frame),
  );
  await new Promise((resolve) => socket.on("open", resolve));
  return { socket, frames };
}

const send = (socket: WebSocket, event: string, data: unknown) =>
  socket.send(JSON.stringify({ event, data }));

/**
 * Follows the run from its start and waits for the server's `subscribed`. Handling a subscription is
 * asynchronous (it reads the history from the database), and the terminal's snapshot is taken at
 * its end: whatever the test does with the terminal before that confirmation may be delivered live
 * AND again in the snapshot. Waiting for the event, not for the agent's state, removes that race.
 */
async function follow(client: { socket: WebSocket; frames: Frame[] }, runId: string) {
  const confirmed = client.frames.filter((frame) => frame.event === "subscribed").length;
  send(client.socket, "subscribe", { runId, fromSeq: 1 });
  await eventually(() =>
    expect(client.frames.filter((frame) => frame.event === "subscribed")).toHaveLength(
      confirmed + 1,
    ),
  );
}

interface WireEvent {
  seq: number;
  type: string;
  agent: string | null;
  payload: Record<string, unknown>;
}

const events = (frames: Frame[], type?: string): WireEvent[] =>
  frames
    .filter((frame) => frame.event === "run.event")
    .map((frame) => frame.data as unknown as WireEvent)
    .filter((event) => type === undefined || event.type === type);

const errors = (frames: Frame[]) =>
  frames.filter((frame) => frame.event === "error").map((frame) => frame.data);

describe("events of the live run (/ws)", () => {
  it("transmits ToolCalled and AgentStateChanged with their seq, and in order", async () => {
    await startServer({
      Pesquisador: async (turn) => {
        await turn.toolCall({
          tool: "consulta_crm",
          inputSummary: '{"cliente":"{{secret:TOKEN_CRM}}"}',
          durationMs: 120,
        });
        const verdict = await turn.ask("Revisor", "está certo?");
        await turn.finish(`ok: ${verdict}`);
      },
      Revisor: (turn) => void turn.reply("certo"),
    });
    const { socket, frames } = await connect();
    const runId = await startRun();
    send(socket, "subscribe", { runId, fromSeq: 1 });

    await eventually(() => expect(events(frames, "RunFinished")).toHaveLength(1));

    const [tool] = events(frames, "ToolCalled");
    expect(tool).toMatchObject({
      agent: "Pesquisador",
      payload: {
        tool: "consulta_crm",
        inputSummary: '{"cliente":"{{secret:TOKEN_CRM}}"}',
        durationMs: 120,
        ok: true,
        errorCode: null,
      },
    });
    const states = (agent: string) =>
      events(frames, "AgentStateChanged")
        .filter((event) => event.agent === agent)
        .map((event) => event.payload.state as string);
    // After `finish` the fake goes idle by itself before the run stops it: only the end is certain.
    expect(states("Pesquisador").slice(0, 5)).toEqual([
      "starting",
      "idle",
      "busy",
      "waiting_reply",
      "busy",
    ]);
    expect(states("Pesquisador").at(-1)).toBe("finished");
    expect(states("Revisor").at(0)).toBe("starting");
    expect(states("Revisor").at(-1)).toBe("finished");

    const seqs = events(frames).map((event) => event.seq);
    expect(seqs).toEqual(seqs.map((_, index) => index + 1));
  });
});

describe("terminal.input", () => {
  let hold = deferred();
  const typed = (fakes: FakeAgentRuntimeFactory): string[] =>
    (fakes.runtimeOf("Pesquisador") as FakeTerminalRuntime | undefined)?.typed ?? [];

  /** Lets the researcher go and waits for the run to end, so nothing outlives the test. */
  const release = async (frames: Frame[]) => {
    hold.resolve();
    await eventually(() => expect(events(frames, "RunFinished")).toHaveLength(1));
  };

  /** A run whose researcher stays busy until the test lets it go. */
  async function startHeldRun(config: Partial<AppConfig> = {}) {
    hold = deferred();
    const fakes = await startServer(
      {
        Pesquisador: async (turn) => {
          await hold.promise;
          await turn.finish("fim");
        },
      },
      config,
    );
    const { socket, frames } = await connect();
    const runId = await startRun();
    await follow({ socket, frames }, runId);
    await eventually(() => expect(fakes.runtimeOf("Pesquisador")?.state).toBe("busy"));
    return { fakes, socket, frames, runId };
  }

  it("types into the terminal of a running agent, with no reply when accepted", async () => {
    const { fakes, socket, frames, runId } = await startHeldRun();

    send(socket, "terminal.input", { runId, agent: "Pesquisador", data: "ls\r" });

    await eventually(() => expect(typed(fakes)).toEqual(["ls\r"]));
    // "No error came back" is proved by an event, not by waiting: a refusal sent after the accepted
    // message is answered, and nothing was answered before it.
    send(socket, "terminal.input", { runId, agent: "Fantasma", data: "x" });
    await eventually(() => expect(errors(frames)).toHaveLength(1));
    expect(errors(frames)).toMatchObject([{ code: "agent_not_in_run" }]);
    await release(frames);
  });

  it("refuses with error { code, message }, and types nothing", async () => {
    const { fakes, socket, frames, runId } = await startHeldRun({
      terminalInput: { maxChars: 10, maxPerSecond: 100 },
    });
    const refuse = (data: Record<string, unknown>) => send(socket, "terminal.input", data);

    refuse({ runId, agent: "Fantasma", data: "x" });
    refuse({ runId, agent: "Revisor", data: "x" });
    refuse({ runId, agent: "Pesquisador", data: "x".repeat(11) });
    refuse({ runId: "0192f1c0-0000-7000-8000-0000000000ff", agent: "Pesquisador", data: "x" });
    refuse({ runId, agent: "Pesquisador" });
    refuse({ runId: "não-é-uuid", agent: "Pesquisador", data: "x" });

    await eventually(() => expect(errors(frames)).toHaveLength(6));
    expect(errors(frames).map((error) => error.code)).toEqual([
      "agent_not_in_run",
      "not_a_terminal",
      "input_too_large",
      "run_not_running",
      "invalid_message",
      "invalid_message",
    ]);
    for (const error of errors(frames)) expect(typeof error.message).toBe("string");
    expect(typed(fakes)).toEqual([]);
    await release(frames);
  });

  it("refuses to type once the run is over", async () => {
    const { socket, frames, runId } = await startHeldRun();
    hold.resolve();
    await eventually(() => expect(events(frames, "RunFinished")).toHaveLength(1));

    send(socket, "terminal.input", { runId, agent: "Pesquisador", data: "tarde" });

    await eventually(() => expect(errors(frames)).toMatchObject([{ code: "run_not_running" }]));
  });

  it("limits the rate of one connection", async () => {
    const { fakes, socket, frames, runId } = await startHeldRun({
      terminalInput: { maxChars: 100, maxPerSecond: 3 },
    });

    // The bucket refills with time, so with a clock that stands still the count is exact: a burst
    // of 3 gets through and the other 7 are refused, however slow the machine is.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (let i = 0; i < 10; i++) {
        send(socket, "terminal.input", { runId, agent: "Pesquisador", data: String(i) });
      }
      await eventually(() => expect(errors(frames)).toHaveLength(7));
      await eventually(() => expect(typed(fakes)).toHaveLength(3));
    } finally {
      vi.useRealTimers();
    }

    expect(errors(frames).every((error) => error.code === "rate_limited")).toBe(true);
    await release(frames);
  });

  it("does not keep what was typed in any event of the run, nor echo it", async () => {
    const { fakes, socket, frames, runId } = await startHeldRun({
      terminalInput: { maxChars: 10, maxPerSecond: 100 },
    });
    const password = "hunter2-senha";
    const short = "pw-curta";

    send(socket, "terminal.input", { runId, agent: "Pesquisador", data: short });
    send(socket, "terminal.input", { runId, agent: "Revisor", data: short });
    send(socket, "terminal.input", { runId, agent: "Pesquisador", data: password });
    await eventually(() => expect(errors(frames)).toHaveLength(2));
    hold.resolve();
    await eventually(() => expect(events(frames, "RunFinished")).toHaveLength(1));

    expect(typed(fakes)).toEqual([short]);
    const everything = JSON.stringify(frames);
    expect(everything).not.toContain(password);
    expect(everything).not.toContain(short);
    const logged = JSON.stringify(
      (await app!.inject({ method: "GET", url: `/runs/${runId}/events?limit=500` })).json(),
    );
    expect(logged).not.toContain(password);
    expect(logged).not.toContain(short);
  });
});

describe("terminal output when a client reconnects", () => {
  it("gives the client what was printed while it was away as a snapshot, since the output is not in the log", async () => {
    const hold = deferred();
    const fakes = await startServer({
      Pesquisador: async (turn) => {
        await hold.promise;
        await turn.finish("fim");
      },
    });
    const first = await connect();
    const runId = await startRun();
    await follow(first, runId);
    await eventually(() => expect(fakes.runtimeOf("Pesquisador")?.state).toBe("busy"));
    const terminal = fakes.runtimeOf("Pesquisador") as FakeTerminalRuntime;
    terminal.print("antes da queda;");
    await eventually(() =>
      expect(first.frames.filter((frame) => frame.event === "run.ephemeral")).toHaveLength(1),
    );

    first.socket.close();
    terminal.print("durante a queda;");
    const second = await connect();
    await follow(second, runId);

    await eventually(() =>
      expect(second.frames.filter((frame) => frame.event === "run.ephemeral")).toMatchObject([
        {
          data: {
            agent: "Pesquisador",
            replay: true,
            data: "antes da queda;durante a queda;",
          },
        },
      ]),
    );
    // The history comes from the log; the terminal is never in it.
    expect(JSON.stringify(events(second.frames))).not.toContain("durante a queda");
    hold.resolve();
    await eventually(() => expect(events(second.frames, "RunFinished")).toHaveLength(1));
  });
});

describe("terminal.resize", () => {
  let hold = deferred();
  const researcher = (fakes: FakeAgentRuntimeFactory) =>
    fakes.runtimeOf("Pesquisador") as FakeTerminalRuntime;
  const sizes = (frames: Frame[]) =>
    frames
      .filter(
        (frame) => frame.event === "run.ephemeral" && frame.data["type"] === "TerminalResized",
      )
      .map((frame) => `${String(frame.data["cols"])}x${String(frame.data["rows"])}`);

  const release = async (frames: Frame[]) => {
    hold.resolve();
    await eventually(() => expect(events(frames, "RunFinished")).toHaveLength(1));
  };

  /** A run whose researcher stays busy (and so keeps its terminal) until the test lets it go. */
  async function startHeldRun() {
    hold = deferred();
    const fakes = await startServer({
      Pesquisador: async (turn) => {
        await hold.promise;
        await turn.finish("fim");
      },
    });
    const first = await connect();
    const runId = await startRun();
    await follow(first, runId);
    await eventually(() => expect(fakes.runtimeOf("Pesquisador")?.state).toBe("busy"));
    return { fakes, runId, ...first };
  }

  it("resizes the terminal and tells everyone who follows the run, with no reply to the asker", async () => {
    const { fakes, socket, frames, runId } = await startHeldRun();

    send(socket, "terminal.resize", { runId, agent: "Pesquisador", cols: 100, rows: 30 });

    await eventually(() => expect(sizes(frames).length).toBeGreaterThan(0));
    await eventually(() => expect(sizes(frames)).toEqual(["100x30"]));
    expect(researcher(fakes).resized).toEqual([{ cols: 100, rows: 30 }]);
    // Never in the run log, like the output.
    expect(JSON.stringify(events(frames))).not.toContain("TerminalResized");
    expect(errors(frames)).toEqual([]);
    await release(frames);
  });

  it("gives the terminal the smallest size among its viewers, and grows back when that viewer leaves", async () => {
    const { socket: big, frames: bigFrames, runId } = await startHeldRun();
    const small = await connect();
    await follow(small, runId);

    send(big, "terminal.resize", { runId, agent: "Pesquisador", cols: 200, rows: 50 });
    await eventually(() => expect(sizes(bigFrames)).toEqual(["200x50"]));
    send(small.socket, "terminal.resize", { runId, agent: "Pesquisador", cols: 80, rows: 24 });
    await eventually(() => expect(sizes(bigFrames)).toEqual(["200x50", "80x24"]));
    // The small viewer is a viewer like any other: a bigger one asking again does not move it.
    send(big, "terminal.resize", { runId, agent: "Pesquisador", cols: 220, rows: 60 });
    send(big, "terminal.input", { runId, agent: "Fantasma", data: "x" }); // a barrier: answered after
    await eventually(() => expect(errors(bigFrames)).toHaveLength(1));
    expect(sizes(bigFrames)).toEqual(["200x50", "80x24"]);

    small.socket.close();
    await eventually(() => expect(sizes(bigFrames)).toEqual(["200x50", "80x24", "220x60"]));
    await release(bigFrames);
  });

  it("gives a client that subscribes late the size the terminal has, with the screen", async () => {
    const { fakes, socket, frames, runId } = await startHeldRun();
    send(socket, "terminal.resize", { runId, agent: "Pesquisador", cols: 100, rows: 30 });
    await eventually(() => expect(sizes(frames)).toEqual(["100x30"]));
    researcher(fakes).print("tela nova");

    const late = await connect();
    await follow(late, runId);

    await eventually(() =>
      expect(late.frames.filter((frame) => frame.event === "run.ephemeral")).toMatchObject([
        { data: { type: "TerminalOutput", data: "tela nova", replay: true, cols: 100, rows: 30 } },
      ]),
    );
    await release(frames);
  });

  it("refuses with error { code, message }, and resizes nothing", async () => {
    const { fakes, socket, frames, runId } = await startHeldRun();
    const refuse = (data: Record<string, unknown>) => send(socket, "terminal.resize", data);
    const ok = { runId, agent: "Pesquisador", cols: 100, rows: 30 };

    refuse({ ...ok, agent: "Fantasma" });
    refuse({ ...ok, agent: "Revisor" });
    refuse({ ...ok, cols: 19 });
    refuse({ ...ok, rows: 201 });
    refuse({ ...ok, runId: "0192f1c0-0000-7000-8000-0000000000ff" });
    refuse({ ...ok, cols: 80.5 });
    refuse({ runId, agent: "Pesquisador", cols: 100 });
    refuse({ ...ok, runId: "não-é-uuid" });

    await eventually(() => expect(errors(frames)).toHaveLength(8));
    expect(
      errors(frames)
        .map((error) => error.code)
        .sort(),
    ).toEqual(
      [
        "agent_not_in_run",
        "invalid_message",
        "invalid_message",
        "invalid_message",
        "invalid_size",
        "invalid_size",
        "not_a_terminal",
        "run_not_running",
      ].sort(),
    );
    for (const error of errors(frames)) expect(typeof error.message).toBe("string");
    expect(researcher(fakes).resized).toEqual([]);
    await release(frames);
  });

  it("refuses to resize once the run is over", async () => {
    const { socket, frames, runId } = await startHeldRun();
    hold.resolve();
    await eventually(() => expect(events(frames, "RunFinished")).toHaveLength(1));

    send(socket, "terminal.resize", { runId, agent: "Pesquisador", cols: 100, rows: 30 });

    await eventually(() => expect(errors(frames)).toMatchObject([{ code: "run_not_running" }]));
  });

  it("limits the rate of one connection", async () => {
    const { fakes, socket, frames, runId } = await startHeldRun();

    // A clock that stands still makes the count exact: a burst of 5 gets through, the rest is refused.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (let i = 0; i < 8; i++) {
        send(socket, "terminal.resize", { runId, agent: "Pesquisador", cols: 80 + i, rows: 24 });
      }
      await eventually(() => expect(errors(frames)).toHaveLength(3));
      await eventually(() => expect(researcher(fakes).resized.length).toBeGreaterThanOrEqual(1));
    } finally {
      vi.useRealTimers();
    }

    expect(errors(frames).every((error) => error.code === "resize_rate_limited")).toBe(true);
    await release(frames);
  });
});
