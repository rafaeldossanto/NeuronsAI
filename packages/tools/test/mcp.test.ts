import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createTools,
  InMemorySecretResolver,
  type ToolLimits,
  type ToolSet,
} from "../src/index.js";
import { isProcessAlive } from "../src/mcp/process-tree.js";
import { createTestServer } from "./fixtures/test-server.js";
import { contentOf, errorCodeOf, findTool, testContext, toolNode } from "./support.js";

const secrets = new InMemorySecretResolver({ TOKEN: "valor-do-token" });
const serverEntry = path.join(import.meta.dirname, "fixtures", "stdio-main.ts");

let sandbox: string;
const open: ToolSet[] = [];

beforeAll(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), "neurons-mcp-"));
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((toolSet) => toolSet.close()));
});

afterAll(() => rm(sandbox, { recursive: true, force: true }));

/**
 * On Windows, `npx` and friends are .cmd shims: the process we spawn is cmd.exe and the real
 * server is its child, so killing only the direct child orphans the server.
 */
async function windowsShim(): Promise<{ command: string; args: string[] }> {
  const shim = path.join(sandbox, "mcp-shim.cmd");
  await writeFile(
    shim,
    `@echo off
"${process.execPath}" "${serverEntry}"
`,
  );
  return { command: shim, args: [] };
}

async function stdioTools(
  allowedTools: string[],
  env: Record<string, string> = {},
  limits: Partial<ToolLimits> = {},
  launcher: { command: string; args: string[] } = {
    command: process.execPath,
    args: [serverEntry],
  },
): Promise<ToolSet> {
  const toolSet = await createTools(
    toolNode({
      kind: "mcp",
      transport: "stdio",
      ...launcher,
      env,
      allowedTools,
    }),
    { secrets, limits },
  );
  open.push(toolSet);
  return toolSet;
}

async function waitUntilDead(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isProcessAlive(pid);
}

async function readPids(file: string): Promise<{ server: number; grandchild: number }> {
  return JSON.parse(await readFile(file, "utf8")) as { server: number; grandchild: number };
}

describe("mcp tools (stdio)", () => {
  it("expõe só as ferramentas de allowedTools, com nome, descrição e schema do servidor", async () => {
    const { tools } = await stdioTools(["echo", "add"]);
    expect(tools.map((tool) => tool.name).sort()).toEqual(["add", "echo"]);
    expect(findTool(tools, "echo")).toMatchObject({
      description: "Devolve o texto recebido.",
      inputSchema: { type: "object", properties: { text: { type: "string" } } },
    });
  });

  it("chama a ferramenta remota e registra a chamada", async () => {
    const { tools } = await stdioTools(["add"]);
    const ctx = testContext({ secrets });
    expect(contentOf(await findTool(tools, "add").execute({ a: 2, b: 3 }, ctx))).toBe("5");
    expect(ctx.calls).toMatchObject([{ tool: "add", ok: true, inputSummary: '{"a":2,"b":3}' }]);
  });

  it("converte isError e entradas inválidas em falhas", async () => {
    const { tools } = await stdioTools(["fail", "echo"]);
    const ctx = testContext({ secrets });
    const failed = await findTool(tools, "fail").execute({}, ctx);
    expect(errorCodeOf(failed)).toBe("MCP_ERROR");
    expect(failed).toMatchObject({ error: { message: "deu ruim" } });

    const echo = findTool(tools, "echo");
    expect(errorCodeOf(await echo.execute("texto", ctx))).toBe("INVALID_INPUT");
    expect(errorCodeOf(await echo.execute({ text: 1 }, ctx))).toBe("MCP_ERROR");
  });

  it("respeita o cancelamento da chamada", async () => {
    const { tools } = await stdioTools(["wait"]);
    const result = await findTool(tools, "wait").execute(
      {},
      testContext({ secrets, signal: AbortSignal.timeout(200) }),
    );
    expect(errorCodeOf(result)).toBe("TIMEOUT");
  });

  it("resolve {{secret:NOME}} no env do servidor", async () => {
    const { tools } = await stdioTools(["read_env"], { MINHA_VAR: "{{secret:TOKEN}}" });
    const result = await findTool(tools, "read_env").execute(
      { name: "MINHA_VAR" },
      testContext({ secrets }),
    );
    expect(contentOf(result)).toBe("valor-do-token");
  });

  it("não repassa ao servidor variáveis do processo pai que não estão no ToolNode", async () => {
    process.env.NEURONS_TEST_SEGREDO_DO_PAI = "nao-deve-vazar";
    try {
      const { tools } = await stdioTools(["read_env"], { DO_NODE: "valor-do-node" });
      const read = (name: string) =>
        findTool(tools, "read_env").execute({ name }, testContext({ secrets }));
      expect(contentOf(await read("DO_NODE"))).toBe("valor-do-node");
      expect(contentOf(await read("NEURONS_TEST_SEGREDO_DO_PAI"))).toBe("(vazio)");
    } finally {
      delete process.env.NEURONS_TEST_SEGREDO_DO_PAI;
    }
  });

  it("trunca resultados grandes", async () => {
    const { tools } = await stdioTools(["echo"], {}, { maxResultChars: 20 });
    const result = await findTool(tools, "echo").execute(
      { text: "x".repeat(100) },
      testContext({ secrets }),
    );
    expect(result).toMatchObject({ ok: true, truncated: true });
  });

  describe("configuração inválida", () => {
    const missingCommand = {
      kind: "mcp",
      transport: "stdio",
      command: "comando-que-nao-existe-neurons",
      args: [] as string[],
    } as const;

    it("falha ao pedir uma ferramenta que o servidor não oferece", async () => {
      await expect(stdioTools(["echo", "inexistente"])).rejects.toMatchObject({
        code: "INVALID_CONFIG",
        message: expect.stringContaining("inexistente") as string,
      });
    });

    it("falha com CONNECTION_FAILED quando o comando não existe", async () => {
      await expect(
        createTools(toolNode({ ...missingCommand, allowedTools: ["echo"] }), { secrets }),
      ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
    });

    it("falha com SECRET_NOT_FOUND quando o env referencia segredo ausente", async () => {
      await expect(stdioTools(["echo"], { X: "{{secret:NAO_EXISTE}}" })).rejects.toMatchObject({
        code: "SECRET_NOT_FOUND",
      });
    });

    it("sem allowedTools não sobe processo algum", async () => {
      const toolSet = await createTools(toolNode({ ...missingCommand, allowedTools: [] }), {
        secrets,
      });
      expect(toolSet.tools).toEqual([]);
    });
  });

  describe("close()", () => {
    it("encerra o processo do servidor", async () => {
      const pidFile = path.join(sandbox, "limpo.json");
      const toolSet = await stdioTools(["echo"], { MCP_PIDFILE: pidFile });
      const { server } = await readPids(pidFile);
      expect(isProcessAlive(server)).toBe(true);
      await toolSet.close();
      expect(await waitUntilDead(server)).toBe(true);
    });

    it("encerra o servidor que ignora o fim do stdin e o processo filho dele", async () => {
      const pidFile = path.join(sandbox, "teimoso.json");
      const toolSet = await stdioTools(["echo"], { MCP_PIDFILE: pidFile, MCP_STUBBORN: "1" });
      const { server, grandchild } = await readPids(pidFile);
      expect(isProcessAlive(grandchild)).toBe(true);
      await toolSet.close();
      expect(await waitUntilDead(server)).toBe(true);
      expect(await waitUntilDead(grandchild)).toBe(true);
    }, 60_000);

    it("derruba a árvore inteira quando o servidor roda atrás de um shim .cmd (Windows)", async (context) => {
      if (process.platform !== "win32") return context.skip();
      const pidFile = path.join(sandbox, "shim.json");
      const toolSet = await stdioTools(
        ["echo"],
        { MCP_PIDFILE: pidFile, MCP_STUBBORN: "1" },
        {},
        await windowsShim(),
      );
      const { server, grandchild } = await readPids(pidFile);
      expect(isProcessAlive(server)).toBe(true);
      await toolSet.close();
      expect(await waitUntilDead(server)).toBe(true);
      expect(await waitUntilDead(grandchild)).toBe(true);
    }, 60_000);

    it("pode ser chamado mais de uma vez", async () => {
      const toolSet = await stdioTools(["echo"]);
      await toolSet.close();
      await expect(toolSet.close()).resolves.toBeUndefined();
    });
  });
});

describe("mcp tools (streamable http)", () => {
  let httpServer: Server;
  let url: string;

  beforeAll(async () => {
    httpServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        void (async () => {
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
          res.on("close", () => void transport.close());
          await createTestServer().connect(transport);
          const body = Buffer.concat(chunks).toString();
          await transport.handleRequest(req, res, body ? (JSON.parse(body) as unknown) : undefined);
        })();
      });
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
  });

  afterAll(() => new Promise<void>((resolve) => httpServer.close(() => resolve())));

  it("filtra por allowedTools e chama a ferramenta remota", async () => {
    const toolSet = await createTools(
      toolNode({ kind: "mcp", transport: "http", url, allowedTools: ["echo"] }),
      { secrets },
    );
    open.push(toolSet);
    expect(toolSet.tools.map((tool) => tool.name)).toEqual(["echo"]);
    const result = await findTool(toolSet.tools, "echo").execute(
      { text: "oi" },
      testContext({ secrets }),
    );
    expect(contentOf(result)).toBe("eco: oi");
  });
});
