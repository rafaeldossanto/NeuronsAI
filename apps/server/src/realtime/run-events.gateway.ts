import { Inject } from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import { SocketAuthorization } from "../accounts/socket-authorization.js";
import {
  type OnGatewayDisconnect,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  type WsResponse,
} from "@nestjs/websockets";
import type { WebSocket } from "ws";
import type { ZodError } from "zod";
import type { EventSink } from "./run-event.js";
import { RunSubscriptions } from "./run-subscriptions.js";
import { DomainError } from "../shared/errors/domain-error.js";
import { TerminalInput } from "./terminal-input.js";
import { TerminalSessions } from "./terminal-sessions.js";
import {
  subscribeMessageSchema,
  terminalInputMessageSchema,
  unsubscribeMessageSchema,
} from "./subscribe-message.js";

type Reply = WsResponse<unknown>;

/**
 * WebSocket endpoint at /ws. Wire format is `{ event, data }` in both directions:
 *   client -> `subscribe { runId, fromSeq? }` | `unsubscribe { runId }`
 *             | `terminal.input { runId, agent, data }` (types into the agent's terminal; no reply when accepted)
 *   server -> `subscribed`, `unsubscribed`, `error { code, message }`, `run.event { ...RunEvent }` and
 *             `run.ephemeral { ...EphemeralRunEvent }` (live only: terminal output, never stored)
 */
@WebSocketGateway({ path: "/ws" })
export class RunEventsGateway implements OnGatewayDisconnect, OnGatewayConnection {
  private readonly requests = new WeakMap<WebSocket, IncomingMessage>();
  constructor(
    @Inject(RunSubscriptions) private readonly subscriptions: RunSubscriptions,
    @Inject(TerminalSessions) private readonly terminals: TerminalSessions,
    @Inject(TerminalInput) private readonly terminalInput: TerminalInput,
    @Inject(SocketAuthorization) private readonly authorization: SocketAuthorization,
  ) {}

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    this.requests.set(client, request);
  }

  /**
   * The sink of a socket is cached, so EVERY path that can create it must carry the authorization
   * policy: a sink born without it (an `unsubscribe` sent first) would deliver without rechecking.
   */
  private sinkOf(client: WebSocket): EventSink {
    return socketSink(
      client,
      this.authorization.enabled
        ? (id, action) => this.authorization.run(this.requests.get(client), id, false, action)
        : undefined,
    );
  }

  @SubscribeMessage("subscribe")
  async subscribe(client: WebSocket, payload: unknown): Promise<Reply> {
    const parsed = subscribeMessageSchema.safeParse(payload);
    if (!parsed.success) return invalidMessage("subscribe", parsed.error);

    const { runId, fromSeq } = parsed.data;
    const sink = this.sinkOf(client);
    try {
      await this.authorization.run(this.requests.get(client), runId, false, async () => {
        await this.subscriptions.subscribe(sink, runId, fromSeq);
        this.terminals.replayTo(sink, runId);
      });
    } catch (error) {
      return socketError(error);
    }
    return { event: "subscribed", data: { runId } };
  }

  @SubscribeMessage("unsubscribe")
  unsubscribe(client: WebSocket, payload: unknown): Reply {
    const parsed = unsubscribeMessageSchema.safeParse(payload);
    if (!parsed.success) return invalidMessage("unsubscribe", parsed.error);

    this.subscriptions.unsubscribe(this.sinkOf(client), parsed.data.runId);
    return { event: "unsubscribed", data: { runId: parsed.data.runId } };
  }

  /**
   * What the person typed is never stored, logged nor echoed back: not even in the error. A refusal
   * is `error { code, message }` (`invalid_message`, `run_not_running`, `agent_not_in_run`,
   * `not_a_terminal`, `terminal_not_ready`, `terminal_unavailable`, `input_too_large`, `rate_limited`).
   */
  @SubscribeMessage("terminal.input")
  async terminalInputMessage(client: WebSocket, payload: unknown): Promise<Reply | undefined> {
    const parsed = terminalInputMessageSchema.safeParse(payload);
    if (!parsed.success) return invalidMessage("terminal.input", parsed.error);
    try {
      await this.authorization.run(this.requests.get(client), parsed.data.runId, true, () =>
        this.terminalInput.write(client, parsed.data),
      );
      return undefined;
    } catch (error) {
      if (error instanceof DomainError) {
        return { event: "error", data: { code: error.code, message: error.message } };
      }
      return {
        event: "error",
        data: { code: "terminal_unavailable", message: "Não foi possível escrever no terminal." },
      };
    }
  }

  handleDisconnect(client: WebSocket): void {
    this.subscriptions.unsubscribeAll(this.sinkOf(client));
  }
}

function socketError(error: unknown): Reply {
  return {
    event: "error",
    data:
      error instanceof DomainError
        ? { code: error.code, message: error.message }
        : { code: "unauthorized", message: "Não autorizado." },
  };
}

// The same socket must always map to the same sink instance, or unsubscribing would not find it.
const sinks = new WeakMap<WebSocket, EventSink>();

function socketSink(
  socket: WebSocket,
  authorize?: (runId: string, action: () => void) => Promise<void>,
): EventSink {
  let sink = sinks.get(socket);
  if (!sink) {
    let pending = Promise.resolve();
    const send = (runId: string, event: string, data: unknown) => {
      const write = () => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ event, data }));
      };
      if (!authorize) return write();
      // Preserve event order while checking revocation/expiry before delivering any new data.
      pending = pending
        .then(() => authorize(runId, write))
        .catch(() => {
          socket.close(1008, "Sessão encerrada.");
        });
    };
    sink = {
      send: (event) => send(event.runId, "run.event", event),
      sendEphemeral: (event) => send(event.runId, "run.ephemeral", event),
    };
    sinks.set(socket, sink);
  }
  return sink;
}

function invalidMessage(event: string, error: ZodError): Reply {
  const detail = error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  return {
    event: "error",
    data: { code: "invalid_message", message: `Mensagem "${event}" inválida: ${detail}` },
  };
}
