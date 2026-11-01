import type { Recorded, RunEventDraft } from "../run-log/run-event-draft.js";
import type { MessageRecord, NewMessage } from "./message.js";

/** Persistence of the messages. Every change that has an event stores both in one transaction. */
export interface MessageStore {
  /** Stores the message (with the next seq of its run) and its `MessageSent` event. */
  append(
    message: NewMessage,
    eventFor: (stored: MessageRecord) => RunEventDraft,
  ): Promise<Recorded<MessageRecord>>;

  /** Sets `delivered_at` if it is still empty (a redelivery keeps the first timestamp). */
  markDelivered(messageId: string): Promise<MessageRecord | undefined>;

  /**
   * Sets `acked_at` (and `delivered_at`, if empty) together with the event. Returns undefined when
   * the message was already acknowledged, so the event is written once.
   */
  markAcked(
    messageId: string,
    eventFor: (stored: MessageRecord) => RunEventDraft,
  ): Promise<Recorded<MessageRecord> | undefined>;

  findById(messageId: string): Promise<MessageRecord | undefined>;

  /** The oldest message to the agent that has not been acknowledged yet (FIFO by seq). */
  findNextPending(runId: string, agent: string): Promise<MessageRecord | undefined>;

  /** Everything not acknowledged in the run, oldest first. */
  listUnacked(runId: string): Promise<MessageRecord[]>;
}

export const MESSAGE_STORE = Symbol("MESSAGE_STORE");
