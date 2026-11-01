import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTools, InMemorySecretResolver, type ToolSet } from "../src/index.js";
import { contentOf, errorCodeOf, testContext, toolNode } from "./support.js";

const API_KEY = "sk-super-secreto-123";
const secrets = new InMemorySecretResolver({ API_KEY, OUTRO: "valor-outro" });

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

let server: Server;
let baseUrl: string;
let lastRequest: Seen | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      lastRequest = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      };
      const route = req.url?.split("?")[0];
      if (route === "/slow") return void setTimeout(() => res.end("tarde demais"), 2_000);
      if (route === "/boom") return void res.writeHead(500, "Erro Interno").end("falhou");
      if (route === "/leaky")
        return void res.writeHead(400).end(`recebi ${req.headers.authorization}`);
      if (route === "/big") return void res.end("a".repeat(50_000));
      if (route === "/empty") return void res.writeHead(204).end();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, echo: lastRequest.body }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function httpTool(
  config: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path?: string;
    headers?: Record<string, string>;
    bodySchema?: unknown;
  },
  options: { name?: string; maxResultChars?: number; httpTimeoutMs?: number } = {},
): Promise<ToolSet> {
  return createTools(
    toolNode(
      {
        kind: "http",
        method: config.method ?? "POST",
        url: `${baseUrl}${config.path ?? "/echo"}`,
        headers: config.headers ?? {},
        ...(config.bodySchema === undefined ? {} : { bodySchema: config.bodySchema }),
      },
      options.name ?? "Pedidos",
    ),
    {
      secrets,
      limits: {
        ...(options.maxResultChars ? { maxResultChars: options.maxResultChars } : {}),
        ...(options.httpTimeoutMs ? { httpTimeoutMs: options.httpTimeoutMs } : {}),
      },
    },
  );
}

const pedidoSchema = {
  type: "object",
  properties: { item: { type: "string" }, quantidade: { type: "integer", minimum: 1 } },
  required: ["item", "quantidade"],
  additionalProperties: false,
};

describe("http tool", () => {
  it("monta a requisição e devolve a resposta", async () => {
    const { tools } = await httpTool({ headers: { "X-Origem": "neurons" } });
    const [tool] = tools;
    expect(tool?.name).toBe("Pedidos");
    const result = await tool?.execute({ body: { item: "caneta" } }, testContext({ secrets }));
    expect(JSON.parse(contentOf(result!))).toMatchObject({ ok: true });
    expect(lastRequest).toMatchObject({ method: "POST", url: "/echo" });
    expect(lastRequest?.headers["x-origem"]).toBe("neurons");
    expect(lastRequest?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(lastRequest?.body ?? "")).toEqual({ item: "caneta" });
  });

  it("GET não aceita corpo e usa schema vazio", async () => {
    const { tools } = await httpTool({ method: "GET", path: "/echo?x=1" });
    expect(tools[0]?.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    contentOf(await tools[0]!.execute({}, testContext({ secrets })));
    expect(lastRequest).toMatchObject({ method: "GET", url: "/echo?x=1", body: "" });
    expect(errorCodeOf((await tools[0]?.execute({ body: {} }, testContext({ secrets })))!)).toBe(
      "INVALID_INPUT",
    );
  });

  it("usa o bodySchema como contrato de entrada e valida o corpo", async () => {
    const { tools } = await httpTool({ bodySchema: pedidoSchema });
    const tool = tools[0]!;
    expect(tool.inputSchema).toMatchObject({
      properties: { body: pedidoSchema },
      required: ["body"],
    });

    const before = lastRequest;
    const invalid = await tool.execute(
      { body: { item: "caneta", quantidade: 0 } },
      testContext({ secrets }),
    );
    expect(errorCodeOf(invalid)).toBe("INVALID_INPUT");
    expect(invalid).toMatchObject({
      error: { message: expect.stringContaining("quantidade") as string },
    });
    expect(lastRequest).toBe(before); // nada foi enviado

    expect(errorCodeOf(await tool.execute({}, testContext({ secrets })))).toBe("INVALID_INPUT");
    contentOf(
      await tool.execute({ body: { item: "caneta", quantidade: 2 } }, testContext({ secrets })),
    );
  });

  it("recusa um bodySchema inválido ao criar as ferramentas", async () => {
    await expect(httpTool({ bodySchema: { type: "nao-existe" } })).rejects.toMatchObject({
      code: "INVALID_CONFIG",
    });
  });

  describe("segredos", () => {
    it("substitui {{secret:NOME}} em url, headers e corpo; o corpo só usa nomes da configuração", async () => {
      const { tools } = await httpTool({
        path: "/echo?k={{secret:API_KEY}}",
        headers: { Authorization: "Bearer {{secret:API_KEY}}" },
      });
      const ctx = testContext({ secrets });
      const result = await tools[0]!.execute(
        { body: { chave: "{{secret:API_KEY}}", nota: "x" } },
        ctx,
      );
      contentOf(result);
      expect(lastRequest?.url).toBe(`/echo?k=${API_KEY}`);
      expect(lastRequest?.headers.authorization).toBe(`Bearer ${API_KEY}`);
      expect(JSON.parse(lastRequest?.body ?? "")).toEqual({ chave: API_KEY, nota: "x" });
    });

    it("não deixa o agente pedir um segredo que a configuração não referencia", async () => {
      const { tools } = await httpTool({ headers: { Authorization: "Bearer {{secret:API_KEY}}" } });
      const result = await tools[0]!.execute(
        { body: { x: "{{secret:OUTRO}}" } },
        testContext({ secrets }),
      );
      expect(errorCodeOf(result)).toBe("SECRET_NOT_FOUND");
    });

    it("mantém o valor fora de inputSummary, de erros e da resposta", async () => {
      const { tools } = await httpTool({
        path: "/leaky",
        headers: { Authorization: "Bearer {{secret:API_KEY}}" },
      });
      const ctx = testContext({ secrets });
      const result = await tools[0]!.execute({ body: { chave: "{{secret:API_KEY}}" } }, ctx);

      expect(errorCodeOf(result)).toBe("HTTP_ERROR");
      expect(JSON.stringify(result)).not.toContain(API_KEY);
      expect(JSON.stringify(result)).toContain("[segredo]");
      expect(JSON.stringify(ctx.calls)).not.toContain(API_KEY);
      expect(ctx.calls[0]?.inputSummary).toContain("{{secret:API_KEY}}");
    });

    it("falha com SECRET_NOT_FOUND sem vazar nada quando o segredo não existe", async () => {
      const { tools } = await httpTool({
        headers: { Authorization: "Bearer {{secret:NAO_EXISTE}}" },
      });
      const ctx = testContext({ secrets });
      const result = await tools[0]!.execute({ body: {} }, ctx);
      expect(errorCodeOf(result)).toBe("SECRET_NOT_FOUND");
      expect(ctx.calls[0]).toMatchObject({ ok: false, errorCode: "SECRET_NOT_FOUND" });
    });

    it("oculta chaves sensíveis no resumo da entrada", async () => {
      const { tools } = await httpTool({});
      const ctx = testContext({ secrets });
      await tools[0]!.execute({ body: { password: "hunter2", item: "caneta" } }, ctx);
      expect(ctx.calls[0]?.inputSummary).not.toContain("hunter2");
      expect(ctx.calls[0]?.inputSummary).toContain("caneta");
    });
  });

  it("transforma erro HTTP em falha com o código HTTP_ERROR", async () => {
    const { tools } = await httpTool({ method: "GET", path: "/boom" });
    const ctx = testContext({ secrets });
    const result = await tools[0]!.execute({}, ctx);
    expect(errorCodeOf(result)).toBe("HTTP_ERROR");
    expect(result).toMatchObject({ error: { message: expect.stringContaining("500") as string } });
    expect(ctx.calls[0]).toMatchObject({ ok: false, errorCode: "HTTP_ERROR" });
  });

  it("devolve NETWORK_ERROR quando o servidor não responde", async () => {
    const { tools } = await createTools(
      toolNode({ kind: "http", method: "GET", url: "http://127.0.0.1:1/", headers: {} }),
      { secrets },
    );
    expect(errorCodeOf(await tools[0]!.execute({}, testContext({ secrets })))).toBe(
      "NETWORK_ERROR",
    );
  });

  describe("tempo limite e cancelamento", () => {
    it("respeita o timeout do signal do chamador", async () => {
      const { tools } = await httpTool({ method: "GET", path: "/slow" });
      const startedAt = Date.now();
      const result = await tools[0]!.execute(
        {},
        testContext({ secrets, signal: AbortSignal.timeout(150) }),
      );
      expect(errorCodeOf(result)).toBe("TIMEOUT");
      expect(Date.now() - startedAt).toBeLessThan(1_500);
    });

    it("aplica o limite próprio da ferramenta além do signal", async () => {
      const { tools } = await httpTool({ method: "GET", path: "/slow" }, { httpTimeoutMs: 150 });
      expect(errorCodeOf(await tools[0]!.execute({}, testContext({ secrets })))).toBe("TIMEOUT");
    });

    it("distingue cancelamento de timeout", async () => {
      const { tools } = await httpTool({ method: "GET", path: "/slow" });
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      const result = await tools[0]!.execute(
        {},
        testContext({ secrets, signal: controller.signal }),
      );
      expect(errorCodeOf(result)).toBe("ABORTED");
    });
  });

  describe("respostas", () => {
    it("trunca respostas grandes no limite configurado", async () => {
      const { tools } = await httpTool({ method: "GET", path: "/big" }, { maxResultChars: 1_000 });
      const result = await tools[0]!.execute({}, testContext({ secrets }));
      expect(result).toMatchObject({ ok: true, truncated: true });
      expect(contentOf(result).length).toBeLessThan(1_100);
    });

    it("não marca como truncada uma resposta pequena", async () => {
      const { tools } = await httpTool({ method: "GET", path: "/empty" });
      expect(await tools[0]!.execute({}, testContext({ secrets }))).toEqual({
        ok: true,
        content: "HTTP 204 (sem conteúdo)",
        truncated: false,
      });
    });
  });

  it("gera nome de ferramenta seguro a partir do nome do bloco", async () => {
    const { tools } = await httpTool({}, { name: "Consulta de Pedidos Açaí!" });
    expect(tools[0]?.name).toBe("Consulta_de_Pedidos_Acai");
  });
});
