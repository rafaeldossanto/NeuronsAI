import type { AddressInfo } from "node:net";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import twoTerminals from "@neurons/graph-schema/examples/two-terminals.json" with { type: "json" };
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  FakeAgentRuntimeFactory,
  FakeTerminalRuntime,
  type FakeScript,
} from "../agents/testing/fake-agent-runtime.js";
import { startTestApi } from "../api/testing/test-api.js";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { deferred, delay, eventually } from "../hub/testing/async-helpers.js";
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
    send(socket, "subscribe", { runId, fromSeq: 1 });
    await eventually(() => expect(fakes.runtimeOf("Pesquisador")?.state).toBe("busy"));
    return { fakes, socket, frames, runId };
  }

  it("types into the terminal of a running agent, with no reply when accepted", async () => {
    const { fakes, socket, frames, runId } = await startHeldRun();

    send(socket, "terminal.input", { runId, agent: "Pesquisador", data: "ls\r" });

    await eventually(() => expect(typed(fakes)).toEqual(["ls\r"]));
    await delay(50);
    expect(errors(frames)).toEqual([]);
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

    for (let i = 0; i < 10; i++) {
      send(socket, "terminal.input", { runId, agent: "Pesquisador", data: String(i) });
    }

    await eventually(() => expect(errors(frames).length).toBeGreaterThan(0));
    expect(errors(frames).every((error) => error.code === "rate_limited")).toBe(true);
    expect(typed(fakes).length).toBeLessThanOrEqual(4);
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
    send(first.socket, "subscribe", { runId, fromSeq: 1 });
    await eventually(() => expect(fakes.runtimeOf("Pesquisador")?.state).toBe("busy"));
    const terminal = fakes.runtimeOf("Pesquisador") as FakeTerminalRuntime;
    terminal.print("antes da queda;");
    await eventually(() =>
      expect(first.frames.filter((frame) => frame.event === "run.ephemeral")).toHaveLength(1),
    );

    first.socket.close();
    terminal.print("durante a queda;");
    const second = await connect();
    send(second.socket, "subscribe", { runId, fromSeq: 1 });

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
