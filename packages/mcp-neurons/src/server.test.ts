import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "./bridge-client.js";
import { McpConfigError, loadMcpConfig } from "./config.js";
import { BRIDGE_ROUTES, mcpToolName } from "./protocol.js";
import { createNeuronsServer } from "./server.js";

// Not a real secret: just long enough to pass the config validation.
const TOKEN = "t".repeat(40);

interface Call {
  route: string;
  authorization: string | undefined;
  body: unknown;
}

type Handler = (call: Call, res: ServerResponse) => void;

/** A stand-in for the runtime's local bridge. */
class FakeBridge {
  readonly calls: Call[] = [];
  handler: Handler = (_call, res) => json(res, 200, {});
  private server: Server | undefined;

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(this.server?.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    this.server?.closeAllConnections();
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    const call = {
      route: req.url ?? "",
      authorization: req.headers.authorization,
      body: JSON.parse(raw) as unknown,
    };
    this.calls.push(call);
    this.handler(call, res);
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>): string =>
  (result.content as { text: string }[]).map((part) => part.text).join("\n");

describe("neurons MCP server", () => {
  const bridge = new FakeBridge();
  let client: Client;
  let bridgeUrl: string;

  async function connect(url: string, askTimeoutMs?: number): Promise<void> {
    const config = { bridgeUrl: url, bridgeToken: TOKEN, ...(askTimeoutMs && { askTimeoutMs }) };
    const server = createNeuronsServer(new BridgeClient(config));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  }

  beforeEach(async () => {
    bridge.calls.length = 0;
    bridge.handler = (_call, res) => json(res, 200, {});
    bridgeUrl = await bridge.start();
    await connect(bridgeUrl);
  });

  afterEach(async () => {
    await client.close();
    await bridge.stop();
  });

  it("exposes communication and graph-authorized tool access", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      ["ask", "finish", "list_peers", "reply", "send_message", "list_tools", "use_tool"].sort(),
    );
    expect(mcpToolName("ask")).toBe("mcp__neurons__ask");
  });

  it("forwards a memory call by graph node id, without a filesystem path supplied by the model", async () => {
    bridge.handler = (call, res) =>
      json(
        res,
        200,
        call.route === BRIDGE_ROUTES.listTools
          ? [
              {
                nodeId: "memoria",
                name: "obsidian_read",
                description: "Ler notas",
                inputSchema: { type: "object" },
              },
            ]
          : { ok: true, content: "Contexto" },
      );
    const listed = await client.callTool({ name: "list_tools" });
    expect(textOf(listed)).toContain("memoria");
    const result = await client.callTool({
      name: "use_tool",
      arguments: { nodeId: "memoria", name: "obsidian_read", input: { path: "Nota.md" } },
    });
    expect(textOf(result)).toContain("Contexto");
    expect(bridge.calls.at(-1)).toMatchObject({
      route: BRIDGE_ROUTES.useTool,
      body: { nodeId: "memoria", name: "obsidian_read", input: { path: "Nota.md" } },
    });
  });

  it("forwards send_message with the bridge token", async () => {
    bridge.handler = (_call, res) => json(res, 200, { messageId: "m-1" });

    const result = await client.callTool({
      name: "send_message",
      arguments: { to: "Revisor", text: "oi" },
    });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("m-1");
    expect(bridge.calls).toEqual([
      {
        route: BRIDGE_ROUTES.sendMessage,
        authorization: `Bearer ${TOKEN}`,
        body: { to: "Revisor", text: "oi" },
      },
    ]);
  });

  it("keeps ask blocked until the bridge answers", async () => {
    let answer: () => void = () => undefined;
    bridge.handler = (_call, res) => {
      answer = () => json(res, 200, { answer: "42" });
    };

    let settled = false;
    const pending = client
      .callTool({ name: "ask", arguments: { to: "Revisor", question: "quanto é?" } })
      .finally(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(settled).toBe(false);

    answer();
    expect(textOf(await pending)).toBe("42");
  });

  it("returns reply, list_peers and finish results", async () => {
    const peers = {
      canMessage: [{ id: "a", name: "Revisor", role: "revisa" }],
      canBeMessagedBy: [],
    };
    bridge.handler = (call, res) => {
      if (call.route === BRIDGE_ROUTES.reply) json(res, 200, { messageId: "m-2" });
      else if (call.route === BRIDGE_ROUTES.listPeers) json(res, 200, peers);
      else json(res, 200, {});
    };

    expect(
      textOf(await client.callTool({ name: "reply", arguments: { messageId: "m-1", text: "ok" } })),
    ).toContain("m-2");
    expect(JSON.parse(textOf(await client.callTool({ name: "list_peers" }))) as unknown).toEqual(
      peers,
    );
    const finished = await client.callTool({ name: "finish", arguments: { result: "pronto" } });
    expect(finished.isError).toBeFalsy();
    expect(bridge.calls.at(-1)?.body).toEqual({ result: "pronto" });
  });

  it("turns a bridge refusal into a tool error carrying the message", async () => {
    bridge.handler = (_call, res) => json(res, 422, { error: "Você não pode escrever a Revisor." });

    const result = await client.callTool({
      name: "send_message",
      arguments: { to: "Revisor", text: "oi" },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Você não pode escrever a Revisor.");
  });

  it("turns an unreachable bridge into a tool error", async () => {
    await client.close();
    await bridge.stop();
    await connect(bridgeUrl);

    const result = await client.callTool({ name: "finish", arguments: { result: "x" } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Não foi possível falar com o servidor");
  });
});

describe("loadMcpConfig", () => {
  const valid = { NEURONS_BRIDGE_URL: "http://127.0.0.1:4567", NEURONS_BRIDGE_TOKEN: TOKEN };

  it("reads the bridge address, the token and the ask timeout", () => {
    expect(loadMcpConfig({ ...valid, NEURONS_ASK_TIMEOUT_MS: "120000" })).toEqual({
      bridgeUrl: "http://127.0.0.1:4567",
      bridgeToken: TOKEN,
      askTimeoutMs: 120_000,
    });
  });

  it("refuses a bridge that is not on loopback, so the token cannot leave the machine", () => {
    expect(() => loadMcpConfig({ ...valid, NEURONS_BRIDGE_URL: "http://example.com:80" })).toThrow(
      McpConfigError,
    );
  });

  it("refuses a missing or short token without echoing it", () => {
    const attempt = () => loadMcpConfig({ ...valid, NEURONS_BRIDGE_TOKEN: "curto" });
    expect(attempt).toThrow(McpConfigError);
    expect(attempt).not.toThrow("curto");
  });
});
