import { Inject } from "@nestjs/common";
import {
  type OnGatewayDisconnect,
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
export class RunEventsGateway implements OnGatewayDisconnect {
  constructor(
    @Inject(RunSubscriptions) private readonly subscriptions: RunSubscriptions,
    @Inject(TerminalSessions) private readonly terminals: TerminalSessions,
    @Inject(TerminalInput) private readonly terminalInput: TerminalInput,
  ) {}

  @SubscribeMessage("subscribe")
  async subscribe(client: WebSocket, payload: unknown): Promise<Reply> {
    const parsed = subscribeMessageSchema.safeParse(payload);
    if (!parsed.success) return invalidMessage("subscribe", parsed.error);

    const { runId, fromSeq } = parsed.data;
    const sink = socketSink(client);
    await this.subscriptions.subscribe(sink, runId, fromSeq);
    this.terminals.replayTo(sink, runId);
    return { event: "subscribed", data: { runId } };
  }

  @SubscribeMessage("unsubscribe")
  unsubscribe(client: WebSocket, payload: unknown): Reply {
    const parsed = unsubscribeMessageSchema.safeParse(payload);
    if (!parsed.success) return invalidMessage("unsubscribe", parsed.error);

    this.subscriptions.unsubscribe(socketSink(client), parsed.data.runId);
    return { event: "unsubscribed", data: { runId: parsed.data.runId } };
  }

  /**
   * What the person typed is never stored, logged nor echoed back: not even in the error. A refusal
   * is `error { code, message }` (`invalid_message`, `run_not_running`, `agent_not_in_run`,
   * `not_a_terminal`, `terminal_not_ready`, `terminal_unavailable`, `input_too_large`, `rate_limited`).
   */
  @SubscribeMessage("terminal.input")
  terminalInputMessage(client: WebSocket, payload: unknown): Reply | undefined {
    const parsed = terminalInputMessageSchema.safeParse(payload);
    if (!parsed.success) return invalidMessage("terminal.input", parsed.error);
    try {
      this.terminalInput.write(client, parsed.data);
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
    this.subscriptions.unsubscribeAll(socketSink(client));
  }
}

// The same socket must always map to the same sink instance, or unsubscribing would not find it.
const sinks = new WeakMap<WebSocket, EventSink>();

function socketSink(socket: WebSocket): EventSink {
  let sink = sinks.get(socket);
  if (!sink) {
    sink = {
      send: (event) => socket.send(JSON.stringify({ event: "run.event", data: event })),
      sendEphemeral: (event) =>
        socket.send(JSON.stringify({ event: "run.ephemeral", data: event })),
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
