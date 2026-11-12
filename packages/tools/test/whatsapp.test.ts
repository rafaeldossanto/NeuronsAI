import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTools,
  InMemorySecretResolver,
  WHATSAPP_GRAPH_VERSION,
  type Tool,
  type WhatsAppRecipient,
} from "../src/index.js";
import { errorCodeOf, testContext, toolNode } from "./support.js";

const PHONE_NUMBER_ID = "106540352242922";
const TOKEN = "EAAGsecret-token-value";
const CUSTOMER = "5511987654321";

interface Received {
  url: string;
  authorization: string | undefined;
  body: unknown;
}

let server: Server;
let baseUrl: string;
let received: Received[];
let reply: { status: number; body: unknown };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push({
        url: req.url ?? "",
        authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
      });
      res.writeHead(reply.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  received = [];
  reply = { status: 200, body: { messages: [{ id: "wamid.X" }] } };
});

const node = toolNode({
  kind: "whatsapp",
  phoneNumberId: PHONE_NUMBER_ID,
  accessTokenSecret: "whatsapp-token",
});

const recipient = (overrides: Partial<WhatsAppRecipient> = {}): WhatsAppRecipient => ({
  to: CUSTOMER,
  phoneNumberId: PHONE_NUMBER_ID,
  customerWroteAt: new Date(),
  ...overrides,
});

async function replyTool(
  options: {
    recipient?: WhatsAppRecipient | undefined;
    network?: Parameters<typeof createTools>[1]["network"];
    graphBaseUrl?: string;
    now?: Date;
  } = {},
): Promise<Tool> {
  const who = "recipient" in options ? options.recipient : recipient();
  const set = await createTools(node, {
    secrets: new InMemorySecretResolver({ "whatsapp-token": TOKEN }),
    ...(options.network && { network: options.network }),
    whatsapp: {
      recipient: () => Promise.resolve(who),
      graphBaseUrl: options.graphBaseUrl ?? baseUrl,
      ...(options.now && { now: () => options.now as Date }),
    },
  });
  const tool = set.tools[0];
  if (!tool) throw new Error("A ferramenta não foi criada.");
  return tool;
}

const context = () =>
  testContext({ secrets: new InMemorySecretResolver({ "whatsapp-token": TOKEN }) });

describe("ferramenta de resposta do WhatsApp", () => {
  it("envia o texto ao cliente da execução, com o token do cofre, pela versão da Graph API", async () => {
    const tool = await replyTool();
    const ctx = context();
    const result = await tool.execute({ text: "Olá! Seu pedido saiu para entrega." }, ctx);

    expect(result.ok).toBe(true);
    expect(received).toEqual([
      {
        url: `/${WHATSAPP_GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`,
        authorization: `Bearer ${TOKEN}`,
        body: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: CUSTOMER,
          type: "text",
          text: { preview_url: false, body: "Olá! Seu pedido saiu para entrega." },
        },
      },
    ]);
  });

  it("não aceita destinatário vindo do agente: só o texto existe na entrada", async () => {
    const tool = await replyTool();
    expect(JSON.stringify(tool.inputSchema)).not.toMatch(/"to"|phone|telefone/i);
    await tool.execute({ text: "oi", to: "5500000000000" }, context());
    expect((received[0]?.body as { to: string }).to).toBe(CUSTOMER);
  });

  it("não envia nada quando a execução não veio de uma mensagem de WhatsApp", async () => {
    const tool = await replyTool({ recipient: undefined });
    const result = await tool.execute({ text: "oi" }, context());
    expect(errorCodeOf(result)).toBe("NOT_FOUND");
    expect(received).toEqual([]);
  });

  it("recusa texto vazio ou grande demais antes de chamar a Meta", async () => {
    const tool = await replyTool();
    expect(errorCodeOf(await tool.execute({ text: "   " }, context()))).toBe("INVALID_INPUT");
    expect(errorCodeOf(await tool.execute({ text: "x".repeat(4097) }, context()))).toBe(
      "INVALID_INPUT",
    );
    expect(received).toEqual([]);
  });

  it("recusa responder por um número diferente do que o cliente escreveu", async () => {
    const tool = await replyTool({ recipient: recipient({ phoneNumberId: "999999999999" }) });
    expect(errorCodeOf(await tool.execute({ text: "oi" }, context()))).toBe("CONFLICT");
    expect(received).toEqual([]);
  });

  it("fora da janela de 24 h falha explicando o template, sem chamar a Meta", async () => {
    const now = new Date("2026-11-11T12:00:00Z");
    const tool = await replyTool({
      now,
      recipient: recipient({ customerWroteAt: new Date("2026-11-10T11:59:00Z") }),
    });
    const result = await tool.execute({ text: "oi" }, context());
    expect(errorCodeOf(result)).toBe("CONFLICT");
    expect(!result.ok && result.error.message).toMatch(/24 horas.*template aprovado/);
    expect(received).toEqual([]);
  });

  it("dentro das 24 h ainda envia", async () => {
    const now = new Date("2026-11-11T12:00:00Z");
    const tool = await replyTool({
      now,
      recipient: recipient({ customerWroteAt: new Date("2026-11-10T12:01:00Z") }),
    });
    expect((await tool.execute({ text: "oi" }, context())).ok).toBe(true);
  });

  it("traduz o erro 131047 da Meta (janela fechada) para a mesma explicação", async () => {
    reply = {
      status: 400,
      body: { error: { code: 131047, message: "Re-engagement message", fbtrace_id: "abc" } },
    };
    const result = await (await replyTool()).execute({ text: "oi" }, context());
    expect(errorCodeOf(result)).toBe("CONFLICT");
    expect(!result.ok && result.error.message).toMatch(/template aprovado/);
  });

  it("traduz token inválido (190) sem repetir o token nem a mensagem crua", async () => {
    reply = {
      status: 401,
      body: { error: { code: 190, message: `Invalid OAuth access token ${TOKEN}` } },
    };
    const result = await (await replyTool()).execute({ text: "oi" }, context());
    expect(errorCodeOf(result)).toBe("HTTP_ERROR");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(!result.ok && result.error.message).toMatch(/access token/);
  });

  it("devolve outros erros da Meta como falha clara, sem token nem números de telefone", async () => {
    reply = {
      status: 400,
      body: {
        error: {
          code: 100,
          message: `Parâmetro inválido para ${CUSTOMER} com ${TOKEN}`,
        },
      },
    };
    const result = await (await replyTool()).execute({ text: "oi" }, context());
    expect(errorCodeOf(result)).toBe("HTTP_ERROR");
    const text = JSON.stringify(result);
    expect(text).toContain("código 100");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(CUSTOMER);
  });

  it("falha com clareza quando o segredo do token não está cadastrado", async () => {
    const tool = await replyTool();
    const result = await tool.execute({ text: "oi" }, testContext());
    expect(errorCodeOf(result)).toBe("SECRET_NOT_FOUND");
    expect(received).toEqual([]);
  });

  it("registra a chamada sem o texto, o telefone nem o token", async () => {
    const ctx = context();
    await (await replyTool()).execute({ text: "Seu protocolo é 12345" }, ctx);
    const summary = JSON.stringify(ctx.calls);
    expect(summary).not.toContain(CUSTOMER);
    expect(summary).not.toContain(TOKEN);
  });

  describe("nos perfis públicos (guarda de saída)", () => {
    it("passa pela guarda: graph.facebook.com que resolve para endereço interno é barrado", async () => {
      const tool = await replyTool({
        graphBaseUrl: "https://graph.facebook.com",
        network: {
          allowedPorts: [443],
          allowHosts: [],
          resolve: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
        },
      });
      const result = await tool.execute({ text: "oi" }, context());
      expect(errorCodeOf(result)).toBe("DESTINATION_BLOCKED");
      expect(received).toEqual([]);
    });

    it("com a política ativa e o destino liberado, o envio acontece", async () => {
      const tool = await replyTool({
        network: { allowedPorts: [80, 443], allowHosts: ["127.0.0.1"] },
      });
      expect((await tool.execute({ text: "oi" }, context())).ok).toBe(true);
      expect(received).toHaveLength(1);
    });
  });
});
