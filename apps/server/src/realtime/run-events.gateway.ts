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
import { subscribeMessageSchema, unsubscribeMessageSchema } from "./subscribe-message.js";

type Reply = WsResponse<unknown>;

/**
 * WebSocket endpoint at /ws. Wire format is `{ event, data }` in both directions:
 *   client -> `subscribe { runId, fromSeq? }` | `unsubscribe { runId }`
 *   server -> `subscribed`, `unsubscribed`, `error { code, message }` and `run.event { ...RunEvent }`
 */
@WebSocketGateway({ path: "/ws" })
export class RunEventsGateway implements OnGatewayDisconnect {
  constructor(@Inject(RunSubscriptions) private readonly subscriptions: RunSubscriptions) {}

  @SubscribeMessage("subscribe")
  async subscribe(client: WebSocket, payload: unknown): Promise<Reply> {
    const parsed = subscribeMessageSchema.safeParse(payload);
    if (!parsed.success) return invalidMessage("subscribe", parsed.error);

    const { runId, fromSeq } = parsed.data;
    await this.subscriptions.subscribe(socketSink(client), runId, fromSeq);
    return { event: "subscribed", data: { runId } };
  }

  @SubscribeMessage("unsubscribe")
  unsubscribe(client: WebSocket, payload: unknown): Reply {
    const parsed = unsubscribeMessageSchema.safeParse(payload);
    if (!parsed.success) return invalidMessage("unsubscribe", parsed.error);

    this.subscriptions.unsubscribe(socketSink(client), parsed.data.runId);
    return { event: "unsubscribed", data: { runId: parsed.data.runId } };
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
    sink = { send: (event) => socket.send(JSON.stringify({ event: "run.event", data: event })) };
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
