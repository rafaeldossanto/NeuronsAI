import type { z } from "zod";
import type { McpConfig } from "./config.js";
import {
  BRIDGE_ROUTES,
  askResponse,
  bridgeErrorResponse,
  finishResponse,
  listPeersResponse,
  replyResponse,
  sendMessageResponse,
  graphToolsResponse,
  graphToolResponse,
  type ListPeersResponse,
} from "./protocol.js";

const DEFAULT_CALL_TIMEOUT_MS = 30_000;
/** Extra time over the Hub's `ask` timeout, so the Hub's own answer (a timeout error) arrives first. */
const ASK_MARGIN_MS = 15_000;

/** A failed call, with a message already meant for the model. */
export class BridgeCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeCallError";
  }
}

/** Calls the runtime's local bridge on behalf of the model. */
export class BridgeClient {
  constructor(private readonly config: McpConfig) {}

  async sendMessage(to: string, text: string): Promise<string> {
    const body = { to, text };
    const { messageId } = await this.post(BRIDGE_ROUTES.sendMessage, body, sendMessageResponse);
    return messageId;
  }

  async ask(to: string, question: string): Promise<string> {
    const waitMs = this.config.askTimeoutMs && this.config.askTimeoutMs + ASK_MARGIN_MS;
    const { answer } = await this.post(BRIDGE_ROUTES.ask, { to, question }, askResponse, waitMs);
    return answer;
  }

  async reply(messageId: string, text: string): Promise<string> {
    const response = await this.post(BRIDGE_ROUTES.reply, { messageId, text }, replyResponse);
    return response.messageId;
  }

  listPeers(): Promise<ListPeersResponse> {
    return this.post(BRIDGE_ROUTES.listPeers, {}, listPeersResponse);
  }

  async finish(result: string): Promise<void> {
    await this.post(BRIDGE_ROUTES.finish, { result }, finishResponse);
  }

  listTools() {
    return this.post(BRIDGE_ROUTES.listTools, {}, graphToolsResponse);
  }
  useTool(nodeId: string, name: string, input: Record<string, unknown>) {
    return this.post(BRIDGE_ROUTES.useTool, { nodeId, name, input }, graphToolResponse);
  }

  private async post<T extends z.ZodType>(
    route: string,
    body: unknown,
    schema: T,
    timeoutMs: number = DEFAULT_CALL_TIMEOUT_MS,
  ): Promise<z.infer<T>> {
    let response: Response;
    try {
      response = await fetch(`${this.config.bridgeUrl}${route}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.bridgeToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new BridgeCallError(
        "Não foi possível falar com o servidor do Neurons agora (a execução pode ter terminado).",
      );
    }

    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const failure = bridgeErrorResponse.safeParse(payload);
      throw new BridgeCallError(
        failure.success
          ? failure.data.error
          : `O servidor do Neurons recusou o pedido (${response.status}).`,
      );
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new BridgeCallError("O servidor do Neurons respondeu em um formato inesperado.");
    }
    return parsed.data;
  }
}
