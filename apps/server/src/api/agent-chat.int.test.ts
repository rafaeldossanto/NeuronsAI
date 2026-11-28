import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import twoAgents from "@neurons/graph-schema/examples/two-agents.json" with { type: "json" };
import { afterAll, beforeAll, expect, it } from "vitest";
import { FakeAgentRuntimeFactory } from "../agents/testing/fake-agent-runtime.js";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { deferred, eventually } from "../hub/testing/async-helpers.js";
import { startTestApi } from "./testing/test-api.js";

const runtimes = new FakeAgentRuntimeFactory();
const image = {
  name: "propostas.png",
  mediaType: "image/png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a14kAAAAASUVORK5CYII=",
};
const agentId = "agente-revisor";
let testDb: TestDatabase;
let app: NestFastifyApplication;

beforeAll(async () => {
  testDb = await startTestDatabase();
  app = await startTestApi(testDb, { runtimes });
});

afterAll(async () => {
  await app?.close();
  await testDb?.stop();
});

async function call<T>(
  method: "GET" | "POST" | "PATCH",
  url: string,
  status: number,
  payload?: object,
): Promise<T> {
  const response = await app.inject({ method, url, ...(payload && { payload }) });
  expect(response.statusCode, response.body).toBe(status);
  return response.json<T>();
}

async function publish(graphId: string, agentName: string) {
  const definition = {
    ...twoAgents,
    id: graphId,
    name: "Operação comercial",
    nodes: twoAgents.nodes.map((node) =>
      node.id === agentId ? { ...node, name: agentName } : node,
    ),
  };
  await call("PATCH", `/graphs/${graphId}`, 200, { draft: definition });
  await call("POST", `/graphs/${graphId}/versions`, 201, { definition });
}

interface ChatTurn {
  runId: string;
  status: string;
  input: string;
  imageName: string | null;
  replies: { text: string }[];
}

it("starts at the selected block, records actual handoffs and keeps the chat after renaming it", async () => {
  const { id } = await call<{ id: string }>("POST", "/graphs", 201, {
    name: "Operação comercial",
  });
  const endpoint = `/graphs/${id}/agent-chats/${agentId}/turns`;
  const history = () => call<{ items: ChatTurn[] }>("GET", endpoint, 200);
  await publish(id, "Revisor");

  const firstTurn = deferred();
  runtimes.setScript("Revisor", async (turn) => {
    await turn.send("Pesquisador", "Confira a primeira proposta.");
    await firstTurn.promise;
    await turn.reply("Duas propostas precisam de retorno.");
  });

  const { runId } = await call<{ runId: string }>("POST", endpoint, 201, { body: "", image });
  try {
    const busy = await call<{ code: string }>("POST", endpoint, 409, { body: "Outra mensagem" });
    expect(busy.code).toBe("agent_chat_busy");
  } finally {
    firstTurn.resolve();
  }
  await eventually(async () => {
    const { items } = await history();
    expect(items).toMatchObject([
      {
        runId,
        status: "succeeded",
        input: "",
        imageName: "propostas.png",
        replies: [{ text: "Duas propostas precisam de retorno." }],
      },
    ]);
  });
  expect(runtimes.runtimeOf("Revisor")?.received[0]).toMatchObject({
    from: "@human",
    chat: { image },
  });
  expect(runtimes.runtimeOf("Pesquisador")?.received[0]).toMatchObject({
    from: "Revisor",
    body: "Confira a primeira proposta.",
  });

  const events = await call<{
    items: { type: string; payload: { from?: string; to?: string } }[];
  }>("GET", `/runs/${runId}/events`, 200);
  const handoffs = events.items
    .filter(({ type }) => type === "MessageSent")
    .map(({ payload }) => [payload.from, payload.to]);
  expect(handoffs).toContainEqual(["@human", "Revisor"]);
  expect(handoffs).toContainEqual(["Revisor", "Pesquisador"]);
  expect(JSON.stringify(events)).not.toContain(image.base64);

  await publish(id, "Agente_Cloud_Vendas");
  runtimes.setScript("Agente_Cloud_Vendas", async (turn) => {
    await turn.reply("A primeira vence na sexta.");
  });

  const next = await call<{ runId: string }>("POST", endpoint, 201, {
    body: "Qual vence primeiro?",
  });
  await eventually(async () => {
    const { items } = await history();
    expect(items).toMatchObject([
      { runId: next.runId, status: "succeeded", replies: [{ text: "A primeira vence na sexta." }] },
      { runId, replies: [{ text: "Duas propostas precisam de retorno." }] },
    ]);
  });
  expect(runtimes.runtimeOf("Agente_Cloud_Vendas")?.received[0]?.chat?.history).toContain(
    "Duas propostas precisam de retorno.",
  );
  expect(
    await call<{ items: ChatTurn[] }>(
      "GET",
      `/graphs/${id}/agent-chats/agente-pesquisador/turns`,
      200,
    ),
  ).toMatchObject({ items: [] });
});
