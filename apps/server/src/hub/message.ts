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
  /** The recipient is not an agent (`@human`, `@trigger`): nobody to hand it to, so it is stored as delivered. */
  deliveredOnArrival: boolean;
}
