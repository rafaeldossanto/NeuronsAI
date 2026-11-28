import type { ChatMessageContext } from "@neurons/agent-runtimes";
import type { MessageKind } from "../database/schema/index.js";

export interface MessageRecord {
  id: string;
  runId: string;
  /** Position in the run's log (seq of the `MessageSent` event): the delivery order. */
  seq: number;
  from: string;
  to: string;
  kind: MessageKind;
  replyTo: string | null;
  body: string;
  chat?: ChatMessageContext;
  createdAt: Date;
  deliveredAt: Date | null;
  ackedAt: Date | null;
}

export interface NewMessage {
  runId: string;
  from: string;
  to: string;
  kind: MessageKind;
  replyTo: string | null;
  body: string;
  chat?: ChatMessageContext;
  /** The recipient is not an agent (`@human`, `@trigger`): nobody to hand it to, so it is stored as delivered. */
  deliveredOnArrival: boolean;
}

/** Keep earlier turns separate from the text the user just sent. */
export function formatChatBody(body: string, history?: string): string {
  if (!history) return body;
  return `Histórico da conversa (referência):\n${history}\n\nMensagem atual:\n${body}`;
}
