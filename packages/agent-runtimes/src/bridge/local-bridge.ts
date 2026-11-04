import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  BRIDGE_ROUTES,
  askRequest,
  finishRequest,
  replyRequest,
  sendMessageRequest,
  useToolRequest,
} from "@neurons/mcp-neurons";
import type { z } from "zod";
import type { AgentCommunication } from "../contract/agent-communication.js";
import { silentLogger, type RuntimeLogger } from "../contract/logger.js";

const LOOPBACK = "127.0.0.1";
const MAX_BODY_BYTES = 1_000_000;
const TOKEN_BYTES = 32;

/** Notices the CLI's own hooks post to the bridge. Each one is optional. */
export interface BridgeHooks {
  onUserPromptSubmit?(): void;
  onStop?(): void;
}

export interface LocalBridgeOptions {
  communication: AgentCommunication;
  hooks?: BridgeHooks;
  logger?: RuntimeLogger;
}

type Handler = (body: unknown) => Promise<unknown>;

/** Thrown for requests that are wrong by themselves, not because the Hub refused them. */
class HttpProblem extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The HTTP endpoint one runtime opens on 127.0.0.1 (random port) for the `neurons` MCP server and
 * for the CLI's hooks. Every request needs this runtime's own random token: the bridge belongs to
 * one agent of one run, so a token for another agent (or a stale run) is simply refused.
 */
export class LocalBridge {
  /** Random per bridge, hence per agent and per execution. Goes to the CLI's config files only. */
  readonly token = randomBytes(TOKEN_BYTES).toString("base64url");

  private readonly routes = new Map<string, Handler>();
  private readonly logger: RuntimeLogger;
  private server: Server | undefined;
  private address: string | undefined;

  constructor(private readonly options: LocalBridgeOptions) {
    this.logger = options.logger ?? silentLogger;
    const { communication, hooks } = options;

    this.tool(BRIDGE_ROUTES.sendMessage, sendMessageRequest, ({ to, text }) =>
      communication.sendMessage(to, text),
    );
    this.tool(BRIDGE_ROUTES.ask, askRequest, async ({ to, question }) => ({
      answer: await communication.ask(to, question),
    }));
    this.tool(BRIDGE_ROUTES.reply, replyRequest, ({ messageId, text }) =>
      communication.reply(messageId, text),
    );
    this.tool(BRIDGE_ROUTES.listPeers, undefined, () => Promise.resolve(communication.listPeers()));
    this.tool(BRIDGE_ROUTES.finish, finishRequest, async ({ result }) => {
      await communication.finish(result);
      return {};
    });
    this.tool(
      BRIDGE_ROUTES.listTools,
      undefined,
      () => communication.listTools?.() ?? Promise.resolve([]),
    );
    this.tool(BRIDGE_ROUTES.useTool, useToolRequest, ({ nodeId, name, input }) => {
      if (!communication.useTool)
        throw new HttpProblem(422, "Ferramentas indisponíveis neste runner.");
      return communication.useTool(nodeId, name, input);
    });

    this.hook(BRIDGE_ROUTES.hooks.userPromptSubmit, () => hooks?.onUserPromptSubmit?.());
    this.hook(BRIDGE_ROUTES.hooks.stop, () => hooks?.onStop?.());
  }

  /** `http://127.0.0.1:<port>`; only valid after {@link start}. */
  get url(): string {
    if (!this.address) throw new Error("A ponte local ainda não foi iniciada.");
    return this.address;
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => void this.handle(req, res));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, LOOPBACK, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.address = `http://${LOOPBACK}:${(server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // ---- routing ----

  private tool<S extends z.ZodType>(
    route: string,
    schema: S | undefined,
    call: (input: z.infer<S>) => Promise<unknown>,
  ): void {
    this.routes.set(route, (body) => {
      const parsed = schema
        ? schema.safeParse(body)
        : ({ success: true, data: undefined } as const);
      if (!parsed.success) throw new HttpProblem(400, "Pedido inválido para a ferramenta.");
      return call(parsed.data as z.infer<S>);
    });
  }

  private hook(route: string, notify: (() => void) | undefined): void {
    this.routes.set(route, () => {
      notify?.();
      return Promise.resolve({});
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!this.isAuthorized(req.headers.authorization)) {
        throw new HttpProblem(401, "Token da ponte local inválido.");
      }
      const handler = req.method === "POST" ? this.routes.get(req.url ?? "") : undefined;
      if (!handler) throw new HttpProblem(404, "Rota desconhecida.");

      reply(res, 200, await handler(await readJson(req)));
    } catch (error) {
      if (error instanceof HttpProblem) return reply(res, error.status, { error: error.message });
      // The Hub (or the runtime) refused the call: the text is written for the model to read.
      if (error instanceof Error) return reply(res, 422, { error: error.message });
      this.logger.error("Falha inesperada na ponte local.");
      reply(res, 500, { error: "Falha inesperada no servidor do Neurons." });
    }
  }

  private isAuthorized(header: string | undefined): boolean {
    const presented = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    // Hashing first gives both sides the same length, as timingSafeEqual requires.
    return timingSafeEqual(sha256(presented), sha256(this.token));
  }
}

const sha256 = (value: string): Buffer => createHash("sha256").update(value).digest();

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = chunk as Buffer;
    size += part.length;
    if (size > MAX_BODY_BYTES) throw new HttpProblem(413, "Pedido grande demais.");
    chunks.push(part);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpProblem(400, "O corpo do pedido não é um JSON válido.");
  }
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
