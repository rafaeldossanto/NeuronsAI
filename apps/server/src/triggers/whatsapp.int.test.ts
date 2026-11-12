/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any --
   The bodies of the HTTP replies are untyped JSON here: the contract under test is the wire format itself. */
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAgentRuntimeFactory } from "../agents/testing/fake-agent-runtime.js";
import { startTestApi } from "../api/testing/test-api.js";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { eventually } from "../hub/testing/async-helpers.js";
import { WHATSAPP_GRAPH_BASE_URL } from "../memories/graph-tools.service.js";
import type { HooksConfig } from "../shared/config/app-config.js";
import { HooksServer } from "./hooks-server.js";

/**
 * The WhatsApp Cloud API over the whole app, against a **simulated Meta**: a real HTTP request to
 * the hooks port (signed the way Meta signs) starts a run of the published version, the scripted
 * agent calls the reply tool, and the simulated Graph API receives the message to the right number.
 */

const PHONE_NUMBER_ID = "106540352242922";
const APP_SECRET = "meta-app-secret-do-teste";
const ACCESS_TOKEN = "EAAG-token-de-acesso-do-teste";
const CUSTOMER = "5511987654321";
const CUSTOMER_NAME = "Maria da Silva";
const TRIGGER = "gatilho-whatsapp";

let testDb: TestDatabase;
let app: NestFastifyApplication | undefined;
let fakeMeta: Server;
let metaUrl: string;
let sent: { url: string; authorization: string | undefined; body: any }[];
let metaReply: { status: number; body: unknown };

beforeAll(async () => {
  testDb = await startTestDatabase();
  Logger.overrideLogger(false);
  fakeMeta = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      sent.push({
        url: request.url ?? "",
        authorization: request.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
      response.writeHead(metaReply.status, { "content-type": "application/json" });
      response.end(JSON.stringify(metaReply.body));
    });
  });
  await new Promise<void>((resolve) => fakeMeta.listen(0, "127.0.0.1", resolve));
  metaUrl = `http://127.0.0.1:${String((fakeMeta.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => fakeMeta.close(() => resolve()));
  await testDb.stop();
});

beforeEach(() => {
  sent = [];
  metaReply = { status: 200, body: { messages: [{ id: "wamid.resposta" }] } };
});

afterEach(async () => {
  vi.useRealTimers();
  try {
    if (app) {
      await eventually(async () => {
        for (const status of ["pending", "running"] as const) {
          expect((await api("GET", `/runs?status=${status}`)).body.total).toBe(0);
        }
      });
    }
  } finally {
    await app?.close();
    app = undefined;
  }
});

const HOOKS: HooksConfig = { port: 0, host: "127.0.0.1", maxBodyBytes: 4096, ratePerMinute: 1_000 };

/** What the scripted agent saw: the tools it was offered and what the write tool answered. */
const seen: { toolNames: string[]; postAttempt: unknown } = {
  toolNames: [],
  postAttempt: undefined,
};

/** Atendente reads the customer's message, answers through the reply tool and finishes. */
function fakeAgents() {
  return new FakeAgentRuntimeFactory({
    Atendente: async (turn) => {
      const tools = await turn.tools();
      seen.toolNames = tools.map((tool) => tool.name);
      const reply = tools.find((tool) => tool.name === "send_whatsapp_reply");
      if (turn.message.body.includes("tente escrever")) {
        // A prompt-injected agent trying a write tool it was never given.
        const blocked = (await turn.useTool("pedidos-post", "registrar_pedido", {}).then(
          (value) => value,
          (error: Error) => ({ refused: error.message }),
        )) as unknown;
        seen.postAttempt = blocked;
      }
      if (reply) {
        await turn.useTool(reply.nodeId, reply.name, {
          text: "Seu pedido 4521 saiu para entrega.",
        });
      }
      await turn.finish("respondido");
    },
  });
}

async function start() {
  seen.toolNames = [];
  seen.postAttempt = undefined;
  app = await startTestApi(testDb, {
    runtimes: fakeAgents(),
    config: { hooks: HOOKS },
    overrides: [{ provide: WHATSAPP_GRAPH_BASE_URL, useValue: metaUrl }],
  });
  return app;
}

async function api<T = Record<string, any>>(
  method: "GET" | "POST" | "PUT" | "PATCH",
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

const position = { x: 0, y: 0 };

const definitionFor = (graphId: string, linkOverrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id: graphId,
  name: "Atendimento",
  annotations: [],
  nodes: [
    {
      id: TRIGGER,
      type: "trigger",
      position,
      kind: "whatsapp",
      target: "atendente",
      phoneNumberId: PHONE_NUMBER_ID,
      appSecretName: "whatsapp-app-secret",
    },
    {
      id: "atendente",
      type: "agent",
      position,
      name: "Atendente",
      role: "Atende clientes",
      instructions: "Responda ao cliente.",
      effort: "medium",
      runtime: { kind: "api", provider: "anthropic", model: "claude-sonnet-5-5" },
    },
    {
      id: "resposta",
      type: "tool",
      position,
      name: "Resposta",
      tool: {
        kind: "whatsapp",
        phoneNumberId: PHONE_NUMBER_ID,
        accessTokenSecret: "whatsapp-token",
      },
    },
    {
      id: "pedidos-post",
      type: "tool",
      position,
      name: "registrar_pedido",
      tool: { kind: "http", method: "POST", url: "https://pedidos.exemplo.com/novo", headers: {} },
    },
  ],
  links: [
    { id: "l1", from: "atendente", to: "resposta", kind: "uses" },
    { id: "l2", from: "atendente", to: "pedidos-post", kind: "uses", ...linkOverrides },
  ],
});

/** Everything the user does in the app before pasting the URL in Meta, then the URL itself. */
async function readyWhatsApp(linkOverrides: Record<string, unknown> = {}) {
  await api("PUT", "/secrets/whatsapp-app-secret", { value: APP_SECRET });
  await api("PUT", "/secrets/whatsapp-token", { value: ACCESS_TOKEN });
  const { body: graph } = await api("POST", "/graphs", { name: "Atendimento" });
  const id = graph.id as string;
  // The inspector works on the saved draft: that is where the kind of the trigger is known.
  const definition = definitionFor(id, linkOverrides);
  const saved = await api("PATCH", `/graphs/${id}`, { draft: definition });
  expect(saved.status).toBe(200);
  const published = await api("POST", `/graphs/${id}/versions`, { definition });
  expect(published.status).toBe(201);
  const created = await api("POST", `/graphs/${id}/triggers/${TRIGGER}/secret`);
  expect(created.status).toBe(201);
  const enabled = await api("PUT", `/graphs/${id}/triggers/${TRIGGER}/enabled`, { enabled: true });
  expect(enabled.status).toBe(200);
  const hooksPort = app!.get(HooksServer).port!;
  return {
    graphId: id,
    verifyToken: created.body.secret as string,
    url: `http://127.0.0.1:${String(hooksPort)}${created.body.state.hookPath as string}`,
    hooksPort,
  };
}

const sign = (body: string, secret = APP_SECRET) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

function inbound(text: string, id: string, phoneNumberId = PHONE_NUMBER_ID) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: CUSTOMER_NAME }, wa_id: CUSTOMER }],
              messages: [
                {
                  from: CUSTOMER,
                  id,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

const statusBody = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: PHONE_NUMBER_ID },
            statuses: [
              { id: "wamid.resposta", status: "delivered", timestamp: "1", recipient_id: CUSTOMER },
            ],
          },
        },
      ],
    },
  ],
});

async function post(url: string, body: string, signature: string | null = sign(body)) {
  const response = await fetch(url, {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      ...(signature !== null && { "x-hub-signature-256": signature }),
    },
  });
  const text = await response.text();
  return { status: response.status, text, json: text ? JSON.parse(text) : undefined };
}

const runsTotal = async (graphId: string) =>
  (await api("GET", `/runs?graphId=${graphId}`)).body.total as number;

describe("WhatsApp com a Meta simulada", () => {
  it("confirma a URL (GET): devolve o challenge só com o verify token certo", async () => {
    await start();
    const { url, verifyToken } = await readyWhatsApp();
    const query = (token: string, mode = "subscribe") =>
      `${url}?hub.mode=${mode}&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=1158201444`;

    const ok = await fetch(query(verifyToken));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1158201444");
    expect(ok.headers.get("content-type")).toMatch(/^text\/plain/);

    for (const refused of [
      await fetch(query("vt_errado")),
      await fetch(query(verifyToken, "outro")),
      await fetch(`${url}?hub.mode=subscribe&hub.challenge=1`),
      await fetch(url),
    ]) {
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ code: "forbidden", message: "Não autorizado." });
    }
  });

  it("mensagem assinada → execução da versão publicada → o agente responde → a Meta recebe o texto e o número certos", async () => {
    await start();
    const { graphId, url } = await readyWhatsApp();
    const body = inbound("Cadê o meu pedido 4521?", "wamid.entrada-1");

    const reply = await post(url, body);

    expect(reply.status).toBe(200);
    await eventually(async () => {
      expect(await runsTotal(graphId)).toBe(1);
      expect((await api("GET", `/runs?graphId=${graphId}`)).body.items[0].status).toBe("succeeded");
    });

    // The simulated Meta got exactly one send, to the customer, from the configured number.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      url: `/v27.0/${PHONE_NUMBER_ID}/messages`,
      authorization: `Bearer ${ACCESS_TOKEN}`,
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: CUSTOMER,
        type: "text",
        text: { body: "Seu pedido 4521 saiu para entrega." },
      },
    });

    // The agent got the customer's words as the @trigger message, without the number or the name.
    const run = (await api("GET", `/runs?graphId=${graphId}`)).body.items[0];
    const messages = (await api("GET", `/runs/${run.id}/messages`)).body.items as any[];
    expect(messages[0]).toMatchObject({ from: "@trigger", to: "Atendente" });
    expect(messages[0].body).toContain("Cadê o meu pedido 4521?");

    // The run log keeps no phone number, no profile name, no reply text and no token.
    const events = await api("GET", `/runs/${run.id}/events`);
    const everything = JSON.stringify([events.body, messages.slice(1), run]);
    for (const personal of [
      CUSTOMER,
      CUSTOMER_NAME,
      ACCESS_TOKEN,
      APP_SECRET,
      "saiu para entrega",
    ]) {
      expect(everything).not.toContain(personal);
    }
    const toolCalls = (events.body.items as any[]).filter((event) => event.type === "ToolCalled");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].payload).toMatchObject({ tool: "send_whatsapp_reply", ok: true });
  });

  it("assinatura errada → 401 genérico, sem execução e sem envio", async () => {
    await start();
    const { graphId, url } = await readyWhatsApp();
    const body = inbound("oi", "wamid.entrada-2");

    const refused = [
      await post(url, body, sign(body, "outro-app-secret")),
      await post(url, body, null),
      await post(url, body, "sha256=00"),
    ];

    for (const reply of refused) {
      expect(reply.status).toBe(401);
      expect(reply.json).toEqual({ code: "unauthorized", message: "Não autorizado." });
    }
    expect(await runsTotal(graphId)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("a Meta reenviando a mesma mensagem → uma execução só e uma resposta só", async () => {
    await start();
    const { graphId, url } = await readyWhatsApp();
    const body = inbound("oi", "wamid.entrada-3");

    expect((await post(url, body)).status).toBe(200);
    expect((await post(url, body)).status).toBe(200);
    expect((await post(url, inbound("oi", "wamid.entrada-3"))).status).toBe(200);

    await eventually(async () => {
      expect((await api("GET", `/runs?graphId=${graphId}`)).body.items[0].status).toBe("succeeded");
    });
    expect(await runsTotal(graphId)).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("status de entrega → 200 e nenhuma execução", async () => {
    await start();
    const { graphId, url } = await readyWhatsApp();

    expect((await post(url, statusBody)).status).toBe(200);
    expect((await post(url, inbound("x", "wamid.outro-numero", "999999999999"))).status).toBe(200);

    expect(await runsTotal(graphId)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("o agente do gatilho começa sem ferramenta de escrita: não a vê e não consegue usá-la", async () => {
    await start();
    const { graphId, url } = await readyWhatsApp();
    await post(url, inbound("tente escrever um pedido", "wamid.escrita"));

    await eventually(async () => {
      expect((await api("GET", `/runs?graphId=${graphId}`)).body.items[0].status).toBe("succeeded");
    });
    expect(seen.toolNames).toEqual(["send_whatsapp_reply"]);
    expect(seen.postAttempt).toMatchObject({
      refused: expect.stringMatching(/mensagens de clientes/),
    });
  });

  it("a ligação com allowWrite libera a ferramenta de escrita explicitamente", async () => {
    await start();
    const { graphId, url } = await readyWhatsApp({ allowWrite: true });
    await post(url, inbound("oi", "wamid.libera"));

    await eventually(async () => {
      expect((await api("GET", `/runs?graphId=${graphId}`)).body.items[0].status).toBe("succeeded");
    });
    expect(seen.toolNames.sort()).toEqual(["registrar_pedido", "send_whatsapp_reply"]);
  });

  it("erro da Meta vira falha clara da ferramenta, sem o token", async () => {
    await start();
    const { graphId, url } = await readyWhatsApp();
    metaReply = {
      status: 401,
      body: { error: { code: 190, message: `Invalid OAuth access token ${ACCESS_TOKEN}` } },
    };
    await post(url, inbound("oi", "wamid.erro"));

    await eventually(async () => {
      expect((await api("GET", `/runs?graphId=${graphId}`)).body.items[0].status).not.toBe(
        "running",
      );
    });
    const run = (await api("GET", `/runs?graphId=${graphId}`)).body.items[0];
    const events = await api("GET", `/runs/${run.id}/events`);
    expect(events.text).not.toContain(ACCESS_TOKEN);
    const calls = (events.body.items as any[]).filter((event) => event.type === "ToolCalled");
    expect(calls[0].payload).toMatchObject({ ok: false });
  });

  it("a porta da API não serve o webhook, e o webhook comum não aceita a assinatura da Meta", async () => {
    await start();
    const { graphId, url } = await readyWhatsApp();
    const path = new URL(url).pathname;
    const body = inbound("oi", "wamid.api");
    const onApi = await app!.inject({
      method: "POST",
      url: path,
      payload: body,
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) },
    });
    expect(onApi.statusCode).toBe(404);
    expect(await runsTotal(graphId)).toBe(0);
  });
});
