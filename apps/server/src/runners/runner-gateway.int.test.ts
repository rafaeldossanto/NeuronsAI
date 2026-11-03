import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import twoTerminals from "@neurons/graph-schema/examples/two-terminals.json" with { type: "json" };
import { RunnerConnection, RunnerHost, type ConnectionStatus } from "@neurons/runner";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { FakeAgentRuntimeFactory, type FakeScript } from "../agents/testing/fake-agent-runtime.js";
import { startTestApi } from "../api/testing/test-api.js";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { delay, eventually } from "../hub/testing/async-helpers.js";
import type { AppConfig } from "../shared/config/app-config.js";
import { RunnerTokens } from "./runner-tokens.service.js";

let testDb: TestDatabase;
let app: NestFastifyApplication | undefined;
let url: string;
const stoppers: (() => void)[] = [];

beforeAll(async () => {
  testDb = await startTestDatabase();
  Logger.overrideLogger(false);
});

afterAll(async () => {
  await testDb.stop();
});

afterEach(async () => {
  for (const stop of stoppers.splice(0)) stop();
  await app?.close();
  app = undefined;
});

async function startServer(config: Partial<AppConfig> = {}): Promise<NestFastifyApplication> {
  app = await startTestApi(testDb, {
    config: {
      profile: "hybrid",
      runners: { graceMs: 5_000, heartbeatMs: 1_000, waitMs: 5_000 },
      ...config,
    },
  });
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  url = `ws://127.0.0.1:${port}/runner`;
  return app;
}

/** A runner process, as far as the server can tell: a host with fake agents behind a real WebSocket. */
function startRunner(token: string, scripts: Record<string, FakeScript> = {}) {
  const fakes = new FakeAgentRuntimeFactory(scripts);
  const host = new RunnerHost({ name: "runner-de-teste", createFactory: () => fakes });
  const statuses: ConnectionStatus[] = [];
  const connection = new RunnerConnection({
    url,
    token,
    host,
    reconnect: { initialDelayMs: 20, maxDelayMs: 100 },
    onStatus: (status) => statuses.push(status),
  });
  connection.start();
  stoppers.push(() => connection.stop());
  return { fakes, host, connection, statuses };
}

// The database outlives each test, and runner names are unique.
const issueToken = async (name = `runner-${randomUUID()}`): Promise<string> =>
  (await app!.get(RunnerTokens).issue(name)).token;

async function startRun(input = "comece"): Promise<string> {
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
    payload: { graphVersionId: version.json<{ id: string }>().id, input },
  });
  expect(run.statusCode).toBe(201);
  return run.json<{ id: string }>().id;
}

const runDetail = async (runId: string) =>
  (await app!.inject({ method: "GET", url: `/runs/${runId}` })).json<{
    status: string;
    finish: { reason: string; agent: string; result: string } | null;
  }>();

const searchAndReview: Record<string, FakeScript> = {
  Pesquisador: async (turn) => {
    await turn.work(150);
    const verdict = await turn.ask("Revisor", "o resumo está certo?");
    await turn.finish(`resumo validado: ${verdict}`);
  },
  Revisor: async (turn) => {
    await turn.reply("certo");
  },
};

describe("runner endpoint (/runner)", () => {
  beforeEach(async () => {
    await startServer();
  });

  it("runs a whole run on a runner that connects with a valid token", async () => {
    const { fakes } = startRunner(await issueToken(), searchAndReview);

    const runId = await startRun();

    await eventually(async () => expect((await runDetail(runId)).status).toBe("succeeded"));
    expect(await runDetail(runId)).toMatchObject({
      finish: { reason: "finished", agent: "Pesquisador", result: "resumo validado: certo" },
    });
    expect(fakes.runtimeOf("Revisor")?.received).toMatchObject([
      { from: "Pesquisador", kind: "ask", body: "o resumo está certo?" },
    ]);
  });

  it("survives the connection being cut in the middle of the run: nothing is lost or repeated", async () => {
    const runner = startRunner(await issueToken(), searchAndReview);
    const runId = await startRun();
    await eventually(() => expect(runner.fakes.runtimeOf("Pesquisador")).toBeDefined());

    // The researcher is working; its `ask` is made while the connection is down.
    runner.connection.drop();

    await eventually(async () => expect((await runDetail(runId)).status).toBe("succeeded"));
    const { items: messages } = (
      await app!.inject({ method: "GET", url: `/runs/${runId}/messages` })
    ).json<{ items: { from: string; to: string; kind: string }[] }>();
    expect(messages.filter((message) => message.kind === "ask")).toHaveLength(1);
    expect(messages.filter((message) => message.kind === "reply")).toHaveLength(1);
    expect(runner.statuses.map((status) => status.kind)).toContain("disconnected");
    expect(runner.fakes.runtimeOf("Revisor")?.received).toHaveLength(1);
  });

  it("refuses a token it does not know, and tells the runner not to insist", async () => {
    const runner = startRunner("nrn_token-que-nao-existe");

    await eventually(() =>
      expect(runner.statuses).toContainEqual(expect.objectContaining({ kind: "refused" })),
    );
    await delay(100);
    expect(runner.statuses.filter((status) => status.kind === "connecting")).toHaveLength(1);
  });

  it("refuses a runner whose token was revoked, and drops one that is connected", async () => {
    const tokens = app!.get(RunnerTokens);
    const name = `revogado-${randomUUID()}`;
    const token = await issueToken(name);
    const runner = startRunner(token);
    await eventually(() =>
      expect(runner.statuses).toContainEqual(expect.objectContaining({ kind: "connected" })),
    );

    await tokens.revoke(name);

    await eventually(() =>
      expect(runner.statuses).toContainEqual(expect.objectContaining({ kind: "refused" })),
    );
    const again = startRunner(token);
    await eventually(() =>
      expect(again.statuses).toContainEqual(expect.objectContaining({ kind: "refused" })),
    );
  });

  it("answers an upgrade without a token with the reason, as the first frame", async () => {
    const frames: string[] = [];
    const socket = new WebSocket(url);
    stoppers.push(() => socket.close());
    socket.on("message", (data) => frames.push((data as Buffer).toString("utf8")));

    const code = await new Promise<number>((resolve) => socket.on("close", resolve));

    expect(code).toBe(4401);
    expect(JSON.parse(frames[0]!)).toMatchObject({ type: "reject", code: "unauthorized" });
  });

  it("never puts the token in what the server answers or logs", async () => {
    const token = await issueToken();
    const frames: string[] = [];
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
    stoppers.push(() => socket.close());
    socket.on("message", (data) => frames.push((data as Buffer).toString("utf8")));
    await new Promise((resolve) => socket.on("open", resolve));
    socket.send(
      JSON.stringify({
        v: 1,
        type: "register",
        runner: { name: "x" },
        capabilities: { terminal: true, streamJson: true },
        agents: [],
      }),
    );

    await eventually(() => expect(frames.length).toBeGreaterThan(0));
    expect(frames.join("")).not.toContain(token);
    expect(JSON.parse(frames[0]!)).toMatchObject({ type: "registered" });
  });

  it("closes a connection whose first frame is not register", async () => {
    const token = await issueToken();
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
    stoppers.push(() => socket.close());
    await new Promise((resolve) => socket.on("open", resolve));
    const closed = new Promise<number>((resolve) => socket.on("close", resolve));

    socket.send(JSON.stringify({ v: 1, type: "heartbeat" }));

    expect(await closed).toBe(4400);
  });

  it("refuses a protocol version it does not speak", async () => {
    const token = await issueToken();
    const frames: string[] = [];
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
    stoppers.push(() => socket.close());
    socket.on("message", (data) => frames.push((data as Buffer).toString("utf8")));
    await new Promise((resolve) => socket.on("open", resolve));

    socket.send(JSON.stringify({ v: 99, type: "register" }));

    await eventually(() => expect(frames).toHaveLength(1));
    expect(JSON.parse(frames[0]!)).toMatchObject({ type: "reject", code: "unsupported_protocol" });
  });
});

describe("profile local", () => {
  it("does not accept runners from outside: its own runner is embedded", async () => {
    await startServer({ profile: "local" });
    const token = await issueToken();
    const runner = startRunner(token);

    await eventually(() =>
      expect(runner.statuses).toContainEqual(
        expect.objectContaining({ kind: "refused", code: "not_accepted" }),
      ),
    );
  });
});
