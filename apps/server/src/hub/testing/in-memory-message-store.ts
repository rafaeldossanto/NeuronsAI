import { randomUUID } from "node:crypto";
import type { Recorded, RunEventDraft } from "../../run-log/run-event-draft.js";
import type { InMemoryRunLog } from "../../run-log/testing/in-memory-run-log.js";
import type { MessageRecord, NewMessage } from "../message.js";
import type { MessageStore } from "../message-store.js";

/** Messages in memory; seqs and events come from the shared {@link InMemoryRunLog}. */
export class InMemoryMessageStore implements MessageStore {
  private readonly messages: MessageRecord[] = [];

  constructor(private readonly log: InMemoryRunLog) {}

  append(
    message: NewMessage,
    eventFor: (stored: MessageRecord) => RunEventDraft,
  ): Promise<Recorded<MessageRecord>> {
    const seq = this.log.allocateSeqs(message.runId, 1);
    const arrival = message.deliveredOnArrival ? new Date() : null;
    const record: MessageRecord = {
      id: randomUUID(),
      runId: message.runId,
      seq,
      from: message.from,
      to: message.to,
      kind: message.kind,
      replyTo: message.replyTo,
      body: message.body,
      createdAt: new Date(),
      deliveredAt: arrival,
      ackedAt: arrival,
    };
    this.messages.push(record);
    return Promise.resolve({
      record,
      events: this.log.insert(record.runId, seq, [eventFor(record)]),
    });
  }

  markDelivered(messageId: string): Promise<MessageRecord | undefined> {
    const message = this.messages.find((candidate) => candidate.id === messageId);
    if (message) message.deliveredAt ??= new Date();
    return Promise.resolve(message);
  }

  markAcked(
    messageId: string,
    eventFor: (stored: MessageRecord) => RunEventDraft,
  ): Promise<Recorded<MessageRecord> | undefined> {
    const message = this.messages.find((candidate) => candidate.id === messageId);
    if (!message || message.ackedAt) return Promise.resolve(undefined);
    message.deliveredAt ??= new Date();
    message.ackedAt = new Date();
    return this.log
      .append(message.runId, [eventFor(message)])
      .then((events) => ({ record: message, events }));
  }

  findById(messageId: string): Promise<MessageRecord | undefined> {
    return Promise.resolve(this.messages.find((message) => message.id === messageId));
  }

  findNextPending(runId: string, agent: string): Promise<MessageRecord | undefined> {
    return Promise.resolve(this.unackedOf(runId).find((message) => message.to === agent));
  }

  listUnacked(runId: string): Promise<MessageRecord[]> {
    return Promise.resolve(this.unackedOf(runId));
  }

  /** Every message of the run, oldest first (test inspection). */
  allOf(runId: string): MessageRecord[] {
    return this.messages.filter((message) => message.runId === runId).sort((a, b) => a.seq - b.seq);
  }

  private unackedOf(runId: string): MessageRecord[] {
    return this.allOf(runId).filter((message) => !message.ackedAt);
  }
}
