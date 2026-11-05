/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any --
   The bodies of the HTTP replies are untyped JSON here: the contract under test is the wire format itself. */
import { createHmac } from "node:crypto";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import twoTerminals from "@neurons/graph-schema/examples/two-terminals.json" with { type: "json" };
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FakeAgentRuntimeFactory } from "../agents/testing/fake-agent-runtime.js";
import { startTestApi } from "../api/testing/test-api.js";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { eventually } from "../hub/testing/async-helpers.js";
import type { HooksConfig } from "../shared/config/app-config.js";
import { HooksServer } from "./hooks-server.js";

/**
 * The external triggers over the whole app: a real HTTP request to the separate hooks port starts
 * a run of the latest published version, with the fake CLI as the agents.
 */

let testDb: TestDatabase;
let app: NestFastifyApplication | undefined;

beforeAll(async () => {
  testDb = await startTestDatabase();
  Logger.overrideLogger(false);
});

afterAll(async () => {
  await testDb.stop();
});

afterEach(async () => {
  vi.useRealTimers();
  await app?.close();
  app = undefined;
});

const HOOKS: HooksConfig = {
  port: 0,
  host: "127.0.0.1",
  maxBodyBytes: 1024,
  ratePerMinute: 1_000,
};

const WEBHOOK = "gatilho-webhook";
const SCHEDULE = "gatilho-agenda";

/** Pesquisador asks the reviewer and finishes with the answer; nothing here needs a model. */
function fakeAgents() {
  return new FakeAgentRuntimeFactory(
    {
      Pesquisador: async (turn) => {
        const verdict = await turn.ask("Revisor", "está certo?");
        await turn.finish(`ok: ${verdict}`);
      },
      Revisor: (turn) => void turn.reply("certo"),
    },
    { Pesquisador: { terminal: true }, Revisor: {} },
  );
}

async function start(hooks: HooksConfig | null = HOOKS) {
  app = await startTestApi(testDb, {
    runtimes: fakeAgents(),
    config: hooks ? { hooks } : {},
  });
  return app;
}

async function api<T = Record<string, any>>(
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
) {
  const response = await app!.inject({
    method,
    url,
    ...(payload !== undefined && { payload: payload as object }),
  });
  const text = response.body;
  return { status: response.statusCode, body: (text ? JSON.parse(text) : undefined) as T, text };
}

/** two-terminals with its manual trigger turned into a webhook, plus a schedule trigger. */
const definitionFor = (graphId: string, cron = "* * * * *") => ({
  ...twoTerminals,
  id: graphId,
  nodes: [
    ...twoTerminals.nodes.map((node) =>
      node.type === "trigger" ? { ...node, id: WEBHOOK, kind: "webhook" } : node,
    ),
    {
      id: SCHEDULE,
      type: "trigger",
      position: { x: 0, y: 0 },
      kind: "schedule",
      target: "agente-pesquisador",
      cron,
      timezone: "UTC",
    },
  ],
});

async function publishedGraph(cron?: string) {
  const { body: graph } = await api("POST", "/graphs", { name: "Gatilhos" });
  const id = graph.id as string;
  const publish = async () => {
    const reply = await api("POST", `/graphs/${id}/versions`, {
      definition: definitionFor(id, cron),
    });
    expect(reply.status).toBe(201);
    return reply.body as { id: string; version: number };
  };
  return { id, publish, version: await publish() };
}

/** A webhook ready to be called: secret generated, trigger on. */
async function readyWebhook() {
  const graph = await publishedGraph();
  const created = await api("POST", `/graphs/${graph.id}/triggers/${WEBHOOK}/secret`);
  expect(created.status).toBe(201);
  const enabled = await api("PUT", `/graphs/${graph.id}/triggers/${WEBHOOK}/enabled`, {
    enabled: true,
  });
  expect(enabled.status).toBe(200);
  const hooksPort = app!.get(HooksServer).port!;
  return {
    graph,
    secret: created.body.secret as string,
    url: `http://127.0.0.1:${String(hooksPort)}${created.body.state.hookPath as string}`,
    hooksPort,
  };
}

const sign = (secret: string, timestamp: string, body: string) =>
  `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

const nowSec = () => String(Math.floor(Date.now() / 1000));

async function post(
  url: string,
  body: string,
  headers: Record<string, string> = {},
  contentType = "application/json",
) {
  const response = await fetch(url, {
    method: "POST",
    body,
    headers: { "content-type": contentType, ...headers },
  });
  const text = await response.text();
  return { status: response.status, text, json: text ? JSON.parse(text) : undefined };
}

const signedHeaders = (secret: string, body: string, timestamp = nowSec()) => ({
  "x-neurons-timestamp": timestamp,
  "x-neurons-signature": sign(secret, timestamp, body),
});

const runsTotal = async (graphId: string) =>
  (await api("GET", `/runs?graphId=${graphId}`)).body.total as number;

describe("webhook", () => {
  it("a signed POST starts a run of the latest published version with the body as input", async () => {
    await start();
    const { graph, secret, url } = await readyWebhook();
    const latest = await graph.publish(); // version 2: the one that must run
    const body = JSON.stringify({ cliente: "Ana", mensagem: "quero comprar" });

    const reply = await post(url, body, signedHeaders(secret, body));

    expect(reply.status).toBe(202);
    const runId = reply.json.runId as string;
    const run = await api("GET", `/runs/${runId}`);
    expect(run.body).toMatchObject({ graphVersionId: latest.id, input: body });
    expect(latest.version).toBe(2);

    await eventually(async () => {
      expect((await api("GET", `/runs/${runId}`)).body.status).toBe("succeeded");
    });
    const events = (await api("GET", `/runs/${runId}/events`)).body.items as any[];
    expect(events[0]).toMatchObject({
      type: "RunStarted",
      payload: { triggerId: WEBHOOK, input: body, graphVersionId: latest.id },
    });
    const messages = (await api("GET", `/runs/${runId}/messages`)).body.items as any[];
    expect(messages[0]).toMatchObject({ from: "@trigger", to: "Pesquisador", body });
  });

  it("keeps the secret out of every later response and shows the trigger's state", async () => {
    await start();
    const { graph, secret, url, hooksPort } = await readyWebhook();
    const body = "{}";
    await post(url, body, signedHeaders(secret, body));

    const responses = [
      await api("GET", `/graphs/${graph.id}/triggers/${WEBHOOK}`),
      await api("GET", "/secrets"),
      await api("GET", `/graphs/${graph.id}`),
      await api("GET", "/runs"),
      await api("GET", "/openapi.json"),
    ];

    for (const reply of responses) expect(reply.text).not.toContain(secret);
    const state = responses[0]!.body;
    expect(state).toMatchObject({
      triggerId: WEBHOOK,
      enabled: true,
      hasSecret: true,
      hooksPort,
      lastRun: { outcome: "started", note: null },
      nextRunAt: null,
    });
    expect(state.hookPath).toMatch(/^\/hooks\/[A-Za-z0-9_-]{22}$/);
    expect(state).not.toHaveProperty("secret");
    expect(state.hookPath).not.toContain(graph.id);
  });

  it("refuses a wrong, expired or repeated signature with 401 and no detail, and starts nothing", async () => {
    await start();
    const { graph, secret, url } = await readyWebhook();
    const body = '{"mensagem":"oi"}';

    const accepted = await post(url, body, signedHeaders(secret, body));
    expect(accepted.status).toBe(202);
    expect(await runsTotal(graph.id)).toBe(1);

    const refused = [
      // wrong secret
      await post(url, body, signedHeaders("whsec_" + "x".repeat(43), body)),
      // altered body
      await post(url, '{"mensagem":"outra"}', signedHeaders(secret, body)),
      // expired (6 minutes old), correctly signed
      await post(url, body, signedHeaders(secret, body, String(Number(nowSec()) - 360))),
      // no headers at all
      await post(url, body),
    ];
    for (const reply of refused) {
      expect(reply.status).toBe(401);
      expect(reply.json).toEqual({ code: "unauthorized", message: "Não autorizado." });
    }
    expect(await runsTotal(graph.id)).toBe(1);
  });

  it("refuses the exact same request when it is sent again", async () => {
    await start();
    const { graph, secret, url } = await readyWebhook();
    const body = '{"mensagem":"uma vez só"}';
    const headers = signedHeaders(secret, body);

    const first = await post(url, body, headers);
    const second = await post(url, body, headers);

    expect(first.status).toBe(202);
    expect(second.status).toBe(401);
    expect(second.json.code).toBe("unauthorized");
    expect(await runsTotal(graph.id)).toBe(1);
  });

  it("answers 401 the same way for an unknown id and for a trigger that is off", async () => {
    await start();
    const { graph, secret, url, hooksPort } = await readyWebhook();
    const body = "{}";
    await api("PUT", `/graphs/${graph.id}/triggers/${WEBHOOK}/enabled`, { enabled: false });

    const off = await post(url, body, signedHeaders(secret, body));
    const unknown = await post(
      `http://127.0.0.1:${String(hooksPort)}/hooks/${"A".repeat(22)}`,
      body,
      signedHeaders(secret, body),
    );

    expect(off.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(off.text).toBe(unknown.text);
    expect(await runsTotal(graph.id)).toBe(0);
  });

  it("stops accepting the old secret as soon as it is replaced", async () => {
    await start();
    const { graph, secret, url } = await readyWebhook();
    const rotated = await api("POST", `/graphs/${graph.id}/triggers/${WEBHOOK}/secret`);
    const body = "{}";

    const old = await post(url, body, signedHeaders(secret, body));
    const fresh = await post(url, body, signedHeaders(rotated.body.secret as string, body));

    expect(rotated.body.secret).not.toBe(secret);
    expect(old.status).toBe(401);
    expect(fresh.status).toBe(202);
  });

  it("tells an authenticated caller clearly when the version that was published is gone from the trigger", async () => {
    await start();
    const { graph, secret, url } = await readyWebhook();
    // The next version drops the webhook trigger: the call is signed correctly but has nothing to run.
    const definition = definitionFor(graph.id);
    await api("POST", `/graphs/${graph.id}/versions`, {
      definition: { ...definition, nodes: definition.nodes.filter((n) => n.id !== WEBHOOK) },
    });
    const body = "{}";

    const reply = await post(url, body, signedHeaders(secret, body));

    expect(reply.status).toBe(409);
    expect(reply.json).toMatchObject({ code: "trigger_not_in_version" });
    expect(await runsTotal(graph.id)).toBe(0);
  });

  describe("limits of the hooks port", () => {
    it("refuses a body over the limit with 413, before looking at the signature", async () => {
      await start();
      const { graph, secret, url } = await readyWebhook();
      const big = JSON.stringify({ texto: "x".repeat(2_000) });

      const reply = await post(url, big, signedHeaders(secret, big));

      expect(reply.status).toBe(413);
      expect(reply.json.code).toBe("payload_too_large");
      expect(await runsTotal(graph.id)).toBe(0);
    });

    it("takes only JSON or plain text", async () => {
      await start();
      const { graph, secret, url } = await readyWebhook();
      const body = "<xml/>";

      const xml = await post(url, body, signedHeaders(secret, body), "application/xml");
      const form = await post(
        url,
        "a=b",
        signedHeaders(secret, "a=b"),
        "application/x-www-form-urlencoded",
      );
      const text = await post(
        url,
        "mensagem simples",
        signedHeaders(secret, "mensagem simples"),
        "text/plain; charset=utf-8",
      );

      expect([xml.status, form.status]).toEqual([415, 415]);
      expect(text.status).toBe(202);
      expect(await runsTotal(graph.id)).toBe(1);
    });

    it("throttles a trigger that is called too often", async () => {
      await start({ ...HOOKS, ratePerMinute: 2 });
      const { graph, secret, url } = await readyWebhook();

      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const body = JSON.stringify({ n: i });
        statuses.push((await post(url, body, signedHeaders(secret, body))).status);
      }

      expect(statuses).toEqual([202, 202, 429, 429]);
      expect(await runsTotal(graph.id)).toBe(2);
    });
  });

  describe("the hooks port serves only the webhook route", () => {
    it("does not answer the API, the interface, the health check or the docs", async () => {
      await start();
      const { hooksPort, graph } = await readyWebhook();
      const base = `http://127.0.0.1:${String(hooksPort)}`;

      for (const path of [
        "/health",
        "/graphs",
        `/graphs/${graph.id}`,
        "/runs",
        "/secrets",
        "/openapi.json",
        "/",
        "/hooks",
        "/ws",
      ]) {
        const reply = await fetch(`${base}${path}`);
        expect(reply.status, path).toBe(404);
      }
      const post404 = await fetch(`${base}/graphs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "invasor" }),
      });
      expect(post404.status).toBe(404);
      const graphs = (await api<{ items: { name: string }[] }>("GET", "/graphs")).body;
      expect(graphs.items.map((item) => item.name)).not.toContain("invasor");
    });

    it("answers GET on the webhook route with 404 as well", async () => {
      await start();
      const { url } = await readyWebhook();
      expect((await fetch(url)).status).toBe(404);
    });

    it("is off by default: nothing else listens, and the state says so", async () => {
      await start(null);
      const graph = await publishedGraph();
      const created = await api("POST", `/graphs/${graph.id}/triggers/${WEBHOOK}/secret`);

      expect(app!.get(HooksServer).port).toBeUndefined();
      expect(created.body.state.hooksPort).toBeNull();
    });
  });
});

describe("trigger API", () => {
  it("refuses to turn a trigger on without a published version, a secret or the trigger itself", async () => {
    await start();
    const { body: graph } = await api("POST", "/graphs", { name: "Sem versão" });

    const noVersion = await api("PUT", `/graphs/${graph.id}/triggers/${SCHEDULE}/enabled`, {
      enabled: true,
    });
    expect(noVersion.status).toBe(409);
    expect(noVersion.body.code).toBe("no_published_version");

    const published = await publishedGraph();
    const noSecret = await api("PUT", `/graphs/${published.id}/triggers/${WEBHOOK}/enabled`, {
      enabled: true,
    });
    expect(noSecret.body.code).toBe("webhook_secret_required");
    const noTrigger = await api("PUT", `/graphs/${published.id}/triggers/inexistente/enabled`, {
      enabled: true,
    });
    expect(noTrigger.body.code).toBe("trigger_not_in_version");
  });

  it("answers an unknown graph with 404 and shows an untouched trigger as off", async () => {
    await start();
    const unknown = await api("GET", "/graphs/0192f1c0-0000-7000-8000-00000000dead/triggers/x");
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe("graph_not_found");

    const { id } = await publishedGraph();
    const fresh = await api("GET", `/graphs/${id}/triggers/${WEBHOOK}`);
    expect(fresh.body).toEqual({
      triggerId: WEBHOOK,
      enabled: false,
      hookPath: null,
      hooksPort: HOOKS.port === 0 ? app!.get(HooksServer).port : HOOKS.port,
      hasSecret: false,
      secretSetAt: null,
      lastRun: null,
      nextRunAt: null,
    });
  });

  it("refuses an invalid cron or time zone when the graph is published", async () => {
    await start();
    const { body: graph } = await api<{ id: string }>("POST", "/graphs", { name: "Cron ruim" });
    const definition = definitionFor(graph.id, "toda segunda");

    const reply = await api("POST", `/graphs/${graph.id}/versions`, { definition });

    expect(reply.status).toBe(400);
    expect(JSON.stringify(reply.body)).toContain("Expressão cron inválida");
  });
});

describe("schedule", () => {
  it("fires at the next moment of the cron, starts the latest version", async () => {
    await start();
    const graph = await publishedGraph("* * * * *");
    // Hold the previous run open: Pesquisador would finish at once, so look at the state instead.
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
      now: new Date("2026-11-04T12:00:30.000Z"),
    });

    const enabled = await api("PUT", `/graphs/${graph.id}/triggers/${SCHEDULE}/enabled`, {
      enabled: true,
    });
    expect(enabled.body).toMatchObject({
      enabled: true,
      nextRunAt: "2026-11-04T12:01:00.000Z",
    });

    await vi.advanceTimersByTimeAsync(30_000);
    vi.useRealTimers();

    await eventually(async () => {
      const state = (await api("GET", `/graphs/${graph.id}/triggers/${SCHEDULE}`)).body;
      expect(state.lastRun).toMatchObject({ outcome: "started" });
    });
    const state = (await api("GET", `/graphs/${graph.id}/triggers/${SCHEDULE}`)).body;
    const run = await api("GET", `/runs/${state.lastRun.runId}`);
    expect(run.body).toMatchObject({
      graphVersionId: graph.version.id,
      input: expect.stringContaining('Execução agendada (cron "* * * * *")') as string,
    });
    expect(await runsTotal(graph.id)).toBe(1);

    // Leave nothing armed for the next test.
    await api("PUT", `/graphs/${graph.id}/triggers/${SCHEDULE}/enabled`, { enabled: false });
  });
});
