/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any --
   The bodies of the HTTP replies are untyped JSON here: the contract under test is the wire format itself. */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import twoAgents from "@neurons/graph-schema/examples/two-agents.json" with { type: "json" };
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeAgentRuntimeFactory, type FakeScript } from "../agents/testing/fake-agent-runtime.js";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { deferred, eventually } from "../hub/testing/async-helpers.js";
import { startTestApi } from "./testing/test-api.js";

let testDb: TestDatabase;
let app: NestFastifyApplication;
let runtimes: FakeAgentRuntimeFactory;
/** Scripts wait on this, so a run stays alive until the test lets it go. */
let hold = deferred();

const UNKNOWN_ID = "0192f1c0-0000-7000-8000-00000000dead";

beforeAll(async () => {
  testDb = await startTestDatabase();
});

afterAll(async () => {
  await testDb.stop();
});

beforeEach(async () => {
  hold = deferred();
  runtimes = new FakeAgentRuntimeFactory();
  app = await startTestApi(testDb, { runtimes });
});

afterEach(async () => {
  hold.resolve();
  await app.close();
});

interface Reply<T = unknown> {
  status: number;
  body: T;
  text: string;
}

async function call<T = Record<string, any>>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
): Promise<Reply<T>> {
  const response = await app.inject({
    method,
    url,
    ...(payload !== undefined && { payload: payload as object }),
  });
  const text = response.body;
  return { status: response.statusCode, body: (text ? JSON.parse(text) : undefined) as T, text };
}

const errorShape = { code: expect.any(String) as string, message: expect.any(String) as string };

async function createGraph(name = "Pesquisa") {
  return (await call("POST", "/graphs", { name })).body as { id: string };
}

const definitionFor = (graphId: string) => ({ ...twoAgents, id: graphId, name: "Dois agentes" });

async function publish(graphId: string) {
  const reply = await call("POST", `/graphs/${graphId}/versions`, {
    definition: definitionFor(graphId),
  });
  expect(reply.status).toBe(201);
  return reply.body as { id: string; version: number };
}

describe("graphs", () => {
  it("creates, lists, reads, renames and saves the draft of a graph", async () => {
    const created = await call("POST", "/graphs", { name: "Meu grafo", draft: { nodes: [] } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Meu grafo",
      draft: { nodes: [] },
      latestVersion: null,
    });
    const id = created.body.id as string;

    const listed = await call("GET", "/graphs");
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((graph: { id: string }) => graph.id)).toContain(id);
    expect(listed.body.items[0]).not.toHaveProperty("draft");

    const renamed = await call("PATCH", `/graphs/${id}`, { name: "Outro nome" });
    expect(renamed.body).toMatchObject({ name: "Outro nome", draft: { nodes: [] } });
    const saved = await call("PATCH", `/graphs/${id}`, { draft: { nodes: [1] } });
    expect(saved.body).toMatchObject({ name: "Outro nome", draft: { nodes: [1] } });

    expect((await call("GET", `/graphs/${id}`)).body).toMatchObject({
      id,
      name: "Outro nome",
      draft: { nodes: [1] },
    });
  });

  it("answers an unknown graph with 404 in the error shape", async () => {
    for (const reply of [
      await call("GET", `/graphs/${UNKNOWN_ID}`),
      await call("PATCH", `/graphs/${UNKNOWN_ID}`, { name: "x" }),
      await call("DELETE", `/graphs/${UNKNOWN_ID}`),
      await call("GET", `/graphs/${UNKNOWN_ID}/versions`),
    ]) {
      expect(reply.status).toBe(404);
      expect(reply.body).toEqual({ ...errorShape, code: "graph_not_found" });
    }
  });

  it("deletes a graph without versions, and refuses one that has some", async () => {
    const plain = await createGraph("Descartável");
    expect((await call("DELETE", `/graphs/${plain.id}`)).status).toBe(204);
    expect((await call("GET", `/graphs/${plain.id}`)).status).toBe(404);

    const published = await createGraph("Publicado");
    await publish(published.id);
    const refused = await call("DELETE", `/graphs/${published.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "graph_has_versions" });
  });

  describe("versions", () => {
    it("validates and freezes the definition as consecutive versions", async () => {
      const { id } = await createGraph();

      const first = await call("POST", `/graphs/${id}/versions`, { definition: definitionFor(id) });
      const second = await call("POST", `/graphs/${id}/versions`, {
        definition: definitionFor(id),
      });

      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ graphId: id, version: 1 });
      expect(first.body.definition).toMatchObject({ id, name: "Dois agentes" });
      expect(second.body).toMatchObject({ version: 2 });

      const listed = await call("GET", `/graphs/${id}/versions`);
      expect(listed.body.items.map((v: { version: number }) => v.version)).toEqual([1, 2]);
      expect(listed.body.items[0]).not.toHaveProperty("definition");
      expect((await call("GET", `/graphs/${id}/versions/1`)).body.definition).toMatchObject({ id });
      expect((await call("GET", `/graphs/${id}`)).body.latestVersion).toBe(2);
    });

    it("publishes the saved draft when no definition is sent", async () => {
      const { id } = await createGraph();
      await call("PATCH", `/graphs/${id}`, { draft: definitionFor(id) });

      const reply = await call("POST", `/graphs/${id}/versions`, {});

      expect(reply.status).toBe(201);
      expect(reply.body.definition).toMatchObject({ id });
    });

    it("refuses a graph that does not pass validateGraph, saying what to fix", async () => {
      const { id } = await createGraph();
      const duplicated = {
        ...definitionFor(id),
        nodes: definitionFor(id).nodes.map((node) =>
          node.type === "agent" ? { ...node, name: "Mesmo" } : node,
        ),
      };

      const reply = await call("POST", `/graphs/${id}/versions`, { definition: duplicated });

      expect(reply.status).toBe(400);
      expect(reply.body).toMatchObject({ code: "invalid_graph" });
      expect(reply.body.details.length).toBeGreaterThan(0);
      expect(reply.body.details[0]).toEqual({
        code: expect.any(String) as string,
        message: expect.any(String) as string,
        path: expect.any(String) as string,
        nodeId: expect.any(String) as string,
      });
      expect((await call("GET", `/graphs/${id}/versions`)).body.items).toEqual([]);
    });

    it("refuses a definition that belongs to another graph, and a draft that is not a graph", async () => {
      const { id } = await createGraph();
      const other = await call("POST", `/graphs/${id}/versions`, {
        definition: definitionFor(UNKNOWN_ID),
      });
      expect(other.status).toBe(400);
      expect(other.body.details).toEqual([expect.objectContaining({ code: "graph_id_mismatch" })]);

      const noDraft = await call("POST", `/graphs/${id}/versions`, {});
      expect(noDraft.status).toBe(400);
      expect(noDraft.body.code).toBe("invalid_graph");
    });

    it("answers an unknown version with 404", async () => {
      const { id } = await createGraph();
      const reply = await call("GET", `/graphs/${id}/versions/7`);
      expect(reply.status).toBe(404);
      expect(reply.body).toMatchObject({ code: "graph_version_not_found" });
    });
  });
});

describe("request validation and the error shape", () => {
  it("names the fields that are wrong, in Portuguese, without echoing what was sent", async () => {
    const reply = await call("POST", "/graphs", { name: "", draft: 1, extra: "NAO-DEVE-VOLTAR" });

    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({
      code: "validation_failed",
      message: expect.any(String) as string,
      details: [expect.objectContaining({ path: "body.name", code: "too_small" })],
    });
    expect(reply.text).not.toContain("NAO-DEVE-VOLTAR");
  });

  it("validates path parameters and query strings too", async () => {
    const badId = await call("GET", "/graphs/nao-e-um-uuid");
    expect(badId.status).toBe(400);
    expect(badId.body.details[0]).toMatchObject({ path: "params.id" });

    const badQuery = await call("GET", "/runs?limit=0&status=voando");
    expect(badQuery.status).toBe(400);
    expect(badQuery.body.details.map((d: { path: string }) => d.path).sort()).toEqual([
      "query.limit",
      "query.status",
    ]);
  });

  it("answers a body that is not JSON without quoting it", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/graphs",
      headers: { "content-type": "application/json" },
      payload: '{"name": "SEGREDO-NO-CORPO",,}',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "bad_request", message: expect.any(String) as string });
    expect(response.body).not.toContain("SEGREDO-NO-CORPO");
  });

  it("answers an unknown route with the same shape", async () => {
    const reply = await call("GET", "/nao-existe");
    expect(reply.status).toBe(404);
    expect(reply.body).toEqual({ code: "route_not_found", message: expect.any(String) as string });
  });
});

describe("runs", () => {
  /** Pesquisador asks Revisor, who finishes the run; used when the run should end by itself. */
  const finishingScripts: Record<string, FakeScript> = {
    Pesquisador: async (turn) => {
      await turn.send("Revisor", "confere isto");
    },
    Revisor: (turn) => turn.finish("conferido"),
  };

  async function start(extra: Record<string, unknown> = {}) {
    const { id } = await createGraph();
    const version = await publish(id);
    const reply = await call("POST", "/runs", {
      graphVersionId: version.id,
      input: "comece",
      ...extra,
    });
    return { graphId: id, version, reply };
  }

  it("starts a run, which the agents carry out, and shows how it ended", async () => {
    for (const [name, script] of Object.entries(finishingScripts)) runtimes.setScript(name, script);

    const { graphId, version, reply } = await start();

    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({
      graphId,
      graphVersionId: version.id,
      status: "running",
      input: "comece",
      budgetUsd: null,
    });
    const runId = reply.body.id as string;

    await eventually(async () => {
      expect((await call("GET", `/runs/${runId}`)).body.status).toBe("succeeded");
    });
    const detail = (await call("GET", `/runs/${runId}`)).body;
    expect(detail.finish).toMatchObject({
      reason: "finished",
      agent: "Revisor",
      result: "conferido",
    });
    expect(detail.finishedAt).not.toBeNull();
    expect(detail.usage).toEqual({
      total: { costUsd: 0, turns: 0, unknownCostTurns: 0 },
      byAgent: {},
    });

    const messages = (await call("GET", `/runs/${runId}/messages`)).body.items as {
      from: string;
      to: string;
      seq: number;
    }[];
    expect(messages.map((m) => `${m.from}>${m.to}`)).toEqual([
      "@trigger>Pesquisador",
      "Pesquisador>Revisor",
    ]);
    const events = (await call("GET", `/runs/${runId}/events`)).body.items as {
      type: string;
      seq: number;
    }[];
    expect(events[0]?.type).toBe("RunStarted");
    expect(events.at(-1)?.type).toBe("RunFinished");
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
  });

  it("pages the messages and the events", async () => {
    for (const [name, script] of Object.entries(finishingScripts)) runtimes.setScript(name, script);
    const { reply } = await start();
    const runId = reply.body.id as string;
    await eventually(async () => {
      expect((await call("GET", `/runs/${runId}`)).body.status).toBe("succeeded");
    });

    const firstEvent = await call("GET", `/runs/${runId}/events?limit=1`);
    expect(firstEvent.body.items).toHaveLength(1);
    const rest = await call("GET", `/runs/${runId}/events?fromSeq=2`);
    expect(rest.body.items[0].seq).toBe(2);
    const second = await call("GET", `/runs/${runId}/messages?afterSeq=${1}&limit=5`);
    expect(second.body.items.every((m: { seq: number }) => m.seq > 1)).toBe(true);
  });

  it("lists runs newest first, filtered by status and graph", async () => {
    runtimes.setScript("Pesquisador", () => hold.promise);
    const alive = await start();
    for (const [name, script] of Object.entries(finishingScripts)) runtimes.setScript(name, script);
    const done = await start();
    await eventually(async () => {
      expect((await call("GET", `/runs/${done.reply.body.id as string}`)).body.status).toBe(
        "succeeded",
      );
    });

    const all = (await call("GET", "/runs?limit=50")).body.items as { id: string }[];
    const ids = all.map((run) => run.id);
    expect(ids.indexOf(done.reply.body.id as string)).toBeLessThan(
      ids.indexOf(alive.reply.body.id as string),
    );

    const running = (await call("GET", "/runs?status=running")).body.items as { id: string }[];
    expect(running.map((run) => run.id)).toContain(alive.reply.body.id);
    expect(running.map((run) => run.id)).not.toContain(done.reply.body.id);

    const ofGraph = (await call("GET", `/runs?graphId=${done.graphId}`)).body.items as {
      id: string;
    }[];
    expect(ofGraph.map((run) => run.id)).toEqual([done.reply.body.id]);
    expect((await call("GET", "/runs?limit=1")).body.items).toHaveLength(1);
  });

  it("filters, sorts and pages the listing, with the cost summed from the log", async () => {
    type Item = {
      id: string;
      graphVersionId: string;
      costUsd: number;
      turns: number;
      unknownCostTurns: number;
      durationMs: number | null;
    };
    const finishWith = (usage: "cheap" | "dear" | "unknown"): Record<string, FakeScript> => ({
      Pesquisador: async (turn) => {
        if (usage === "unknown") await turn.usageWithoutCost();
        else await turn.usage({ costUsd: usage === "cheap" ? 0.5 : 3 });
        await turn.send("Revisor", "confere isto");
      },
      Revisor: (turn) => turn.finish("conferido"),
    });
    async function finishedRun(versionId: string, usage: "cheap" | "dear" | "unknown") {
      for (const [name, script] of Object.entries(finishWith(usage))) {
        runtimes.setScript(name, script);
      }
      const reply = await call("POST", "/runs", { graphVersionId: versionId, input: "oi" });
      const runId = reply.body.id as string;
      await eventually(async () => {
        expect((await call("GET", `/runs/${runId}`)).body.status).toBe("succeeded");
      });
      return runId;
    }
    const idsOf = async (query: string) =>
      ((await call("GET", `/runs?${query}`)).body.items as Item[]).map((run) => run.id);

    const first = await createGraph("Primeiro");
    const firstV1 = await publish(first.id);
    const firstV2 = await publish(first.id);
    const second = await createGraph("Segundo");
    const secondV1 = await publish(second.id);
    const cheap = await finishedRun(firstV1.id, "cheap");
    const dear = await finishedRun(firstV2.id, "dear");
    const unknown = await finishedRun(secondV1.id, "unknown");

    const page = (await call("GET", `/runs?graphId=${first.id}`)).body;
    expect(page).toMatchObject({ total: 2, limit: 50, offset: 0 });
    expect(page.items.map((run: Item) => run.id)).toEqual([dear, cheap]);
    expect(page.items[1]).toMatchObject({ costUsd: 0.5, turns: 1, unknownCostTurns: 0 });
    expect(page.items[1].durationMs).toBeGreaterThanOrEqual(0);

    // Unknown cost is never zero: it is a turn apart, and the run is compared by its known part.
    const unknownItem = (await call("GET", `/runs?graphId=${second.id}`)).body.items[0] as Item;
    expect(unknownItem).toMatchObject({ id: unknown, costUsd: 0, turns: 1, unknownCostTurns: 1 });

    expect(await idsOf(`graphVersionId=${firstV1.id}`)).toEqual([cheap]);
    expect(await idsOf(`graphId=${first.id}&minCostUsd=1`)).toEqual([dear]);
    expect(await idsOf(`graphId=${first.id}&maxCostUsd=1`)).toEqual([cheap]);
    expect(await idsOf(`graphId=${second.id}&maxCostUsd=0`)).toEqual([unknown]);
    expect(await idsOf(`minCostUsd=0.5&maxCostUsd=3&status=succeeded&graphId=${first.id}`)).toEqual(
      [dear, cheap],
    );
    expect(await idsOf(`graphId=${first.id}&sort=costUsd`)).toEqual([dear, cheap]);
    expect(await idsOf(`graphId=${first.id}&sort=costUsd&order=asc`)).toEqual([cheap, dear]);
    expect(await idsOf("from=2999-01-01T00:00:00.000Z")).toEqual([]);
    expect(
      await idsOf(`graphId=${first.id}&from=2000-01-01T00:00:00Z&to=2999-01-01T00:00:00Z`),
    ).toEqual([dear, cheap]);

    const paged = (await call("GET", `/runs?graphId=${first.id}&limit=1&offset=1`)).body;
    expect(paged).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect(paged.items.map((run: Item) => run.id)).toEqual([cheap]);

    for (const bad of [
      "minCostUsd=2&maxCostUsd=1",
      "from=2026-11-02T00:00:00Z&to=2026-11-01T00:00:00Z",
      "minCostUsd=-1",
      "offset=-1",
      "sort=nome",
      "graphVersionId=x",
    ]) {
      expect((await call("GET", `/runs?${bad}`)).status).toBe(400);
    }
  });

  it("refuses to start from a version that does not exist, and from a bad body", async () => {
    const missing = await call("POST", "/runs", { graphVersionId: UNKNOWN_ID, input: "oi" });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "graph_version_not_found" });

    const bad = await call("POST", "/runs", { graphVersionId: "x", input: "", budgetUsd: -1 });
    expect(bad.status).toBe(400);
    expect(bad.body.details.map((d: { path: string }) => d.path).sort()).toEqual([
      "body.budgetUsd",
      "body.graphVersionId",
      "body.input",
    ]);
  });

  it("answers an unknown run with 404 everywhere", async () => {
    for (const reply of [
      await call("GET", `/runs/${UNKNOWN_ID}`),
      await call("POST", `/runs/${UNKNOWN_ID}/stop`),
      await call("POST", `/runs/${UNKNOWN_ID}/messages`, { to: "Revisor", body: "oi" }),
      await call("GET", `/runs/${UNKNOWN_ID}/messages`),
      await call("GET", `/runs/${UNKNOWN_ID}/events`),
    ]) {
      expect(reply.status).toBe(404);
      expect(reply.body).toEqual({ ...errorShape, code: "run_not_found" });
    }
  });

  describe("stopping", () => {
    it("ends the run and stops every runtime, and can be repeated", async () => {
      runtimes.setScript("Pesquisador", () => hold.promise);
      const { reply } = await start();
      const runId = reply.body.id as string;
      await eventually(() => expect(runtimes.runtimeOf("Pesquisador")?.state).toBe("busy"));

      const stopped = await call("POST", `/runs/${runId}/stop`);

      expect(stopped.status).toBe(200);
      expect(stopped.body).toMatchObject({
        status: "cancelled",
        finish: { reason: "stopped" },
      });
      expect(runtimes.created.length).toBeGreaterThan(0);
      expect(runtimes.created.every((runtime) => runtime.state === "stopped")).toBe(true);

      const again = await call("POST", `/runs/${runId}/stop`);
      expect(again.status).toBe(200);
      expect(again.body.status).toBe("cancelled");
      const finishedEvents = (await call("GET", `/runs/${runId}/events`)).body.items.filter(
        (event: { type: string }) => event.type === "RunFinished",
      );
      expect(finishedEvents).toHaveLength(1);
    });
  });

  describe("messages from the human", () => {
    it("sends a message as @human to any agent of the run, arrows aside", async () => {
      runtimes.setScript("Pesquisador", () => hold.promise);
      const { reply } = await start();
      const runId = reply.body.id as string;

      const sent = await call("POST", `/runs/${runId}/messages`, {
        to: "Revisor",
        body: "Olá, Revisor!",
      });

      expect(sent.status).toBe(201);
      expect(sent.body).toMatchObject({ from: "@human", to: "Revisor", kind: "message" });
      await eventually(() =>
        expect(runtimes.runtimeOf("Revisor")?.received).toMatchObject([
          { from: "@human", body: "Olá, Revisor!" },
        ]),
      );
      const listed = (await call("GET", `/runs/${runId}/messages`)).body.items as {
        from: string;
      }[];
      expect(listed.map((message) => message.from)).toContain("@human");
    });

    it("refuses an agent that is not in the graph", async () => {
      runtimes.setScript("Pesquisador", () => hold.promise);
      const { reply } = await start();

      const refused = await call("POST", `/runs/${reply.body.id as string}/messages`, {
        to: "Fantasma",
        body: "oi",
      });

      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({ code: "unknown_recipient" });
    });

    it("refuses a run that is no longer going on", async () => {
      runtimes.setScript("Pesquisador", () => hold.promise);
      const { reply } = await start();
      const runId = reply.body.id as string;
      await call("POST", `/runs/${runId}/stop`);

      const refused = await call("POST", `/runs/${runId}/messages`, { to: "Revisor", body: "oi" });

      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: "run_not_active" });
    });
  });

  describe("guards", () => {
    it("shows the spending and the guard that stopped the run", async () => {
      runtimes.setScript("Pesquisador", (turn) => turn.usage({ costUsd: 0.5 }));

      const { reply } = await start({ budgetUsd: 0.2 });
      const runId = reply.body.id as string;
      expect(reply.body.budgetUsd).toBe(0.2);

      await eventually(async () => {
        expect((await call("GET", `/runs/${runId}`)).body.status).toBe("failed");
      });
      const detail = (await call("GET", `/runs/${runId}`)).body;
      expect(detail.finish).toMatchObject({
        reason: "guard_tripped",
        guard: "run_budget",
        message: expect.stringContaining("orçamento") as string,
      });
      expect(detail.usage.total).toMatchObject({ costUsd: 0.5, turns: 1, unknownCostTurns: 0 });
      expect(detail.usage.byAgent.Pesquisador).toMatchObject({ costUsd: 0.5 });
      const types = (await call("GET", `/runs/${runId}/events`)).body.items.map(
        (event: { type: string }) => event.type,
      );
      expect(types).toEqual(expect.arrayContaining(["UsageRecorded", "GuardTripped"]));
    });

    it("counts a turn without a price apart, never as zero", async () => {
      runtimes.setScript("Pesquisador", (turn) => turn.usageWithoutCost());
      const { reply } = await start();
      const runId = reply.body.id as string;

      await eventually(async () => {
        expect((await call("GET", `/runs/${runId}`)).body.status).toBe("succeeded");
      });

      const detail = (await call("GET", `/runs/${runId}`)).body;
      expect(detail.usage.total).toEqual({ costUsd: 0, turns: 1, unknownCostTurns: 1 });
    });
  });
});

describe("secrets", () => {
  // Not a real secret: a marker that must never show up anywhere it should not.
  const CANARY = "valor-que-nunca-pode-voltar-4f9a1c";

  it("writes a secret and lists names only, never the value", async () => {
    const written = await call("PUT", "/secrets/WHATSAPP_TOKEN", { value: CANARY });
    expect(written.status).toBe(204);
    expect(written.text).toBe("");
    await call("PUT", "/secrets/WHATSAPP_TOKEN", { value: `${CANARY}-novo` });
    await call("PUT", "/secrets/OUTRO", { value: "x" });

    const listed = await call("GET", "/secrets");

    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ names: ["OUTRO", "WHATSAPP_TOKEN"] });
    expect(listed.text).not.toContain(CANARY);
  });

  it("offers no way to read a value back", async () => {
    await call("PUT", "/secrets/LEITURA", { value: CANARY });

    for (const reply of [
      await call("GET", "/secrets/LEITURA"),
      await call("POST", "/secrets/LEITURA"),
      await call("DELETE", "/secrets/LEITURA"),
    ]) {
      expect(reply.status).toBeGreaterThanOrEqual(400);
      expect(reply.text).not.toContain(CANARY);
    }
  });

  it("never echoes the value in an error", async () => {
    const tooLong = await call("PUT", "/secrets/GRANDE", { value: CANARY.repeat(1000) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.text).not.toContain(CANARY);

    const badName = await call("PUT", "/secrets/nome inválido!", { value: CANARY });
    expect(badName.status).toBe(400);
    expect(badName.text).not.toContain(CANARY);

    const empty = await call("PUT", "/secrets/VAZIO", { value: "" });
    expect(empty.status).toBe(400);

    const broken = await app.inject({
      method: "PUT",
      url: "/secrets/QUEBRADO",
      headers: { "content-type": "application/json" },
      payload: `{"value": "${CANARY}",}`,
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.body).not.toContain(CANARY);
  });

  it("says so when the master key is missing, instead of storing anything", async () => {
    const withoutKey = await startTestApi(testDb, { runtimes, config: { masterKey: undefined } });
    try {
      const reply = await withoutKey.inject({
        method: "PUT",
        url: "/secrets/SEM_CHAVE",
        payload: { value: CANARY },
      });

      expect(reply.statusCode).toBe(503);
      expect(reply.json()).toMatchObject({ code: "master_key_not_configured" });
      expect(reply.body).not.toContain(CANARY);
    } finally {
      await withoutKey.close();
    }
  });
});

describe("OpenAPI document", () => {
  it("is served by the API and describes every endpoint of the contracts", async () => {
    const reply = await call("GET", "/openapi.json");

    expect(reply.status).toBe(200);
    expect(reply.body.openapi).toBe("3.1.0");
    expect(Object.keys(reply.body.paths).sort()).toEqual([
      "/connections",
      "/connections/claude/login",
      "/graphs",
      "/graphs/{id}",
      "/graphs/{id}/triggers/{triggerId}",
      "/graphs/{id}/triggers/{triggerId}/enabled",
      "/graphs/{id}/triggers/{triggerId}/secret",
      "/graphs/{id}/versions",
      "/graphs/{id}/versions/{version}",
      "/memories",
      "/memories/{id}",
      "/runs",
      "/runs/{id}",
      "/runs/{id}/events",
      "/runs/{id}/messages",
      "/runs/{id}/stop",
      "/secrets",
      "/secrets/{name}",
    ]);
  });
});
