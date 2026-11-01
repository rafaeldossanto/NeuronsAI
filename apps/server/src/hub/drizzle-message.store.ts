import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { messages } from "../database/schema/index.js";
import { allocateSeqs, appendEvents, insertEvents } from "../run-log/drizzle-event-writer.js";
import type { Recorded, RunEventDraft } from "../run-log/run-event-draft.js";
import type { MessageRecord, NewMessage } from "./message.js";
import type { MessageStore } from "./message-store.js";

const toMessageRecord = (row: typeof messages.$inferSelect): MessageRecord => ({
  id: row.id,
  runId: row.runId,
  seq: row.seq,
  from: row.fromAgent,
  to: row.toAgent,
  kind: row.kind,
  replyTo: row.replyTo,
  body: row.body,
  createdAt: row.createdAt,
  deliveredAt: row.deliveredAt,
  ackedAt: row.ackedAt,
});

@Injectable()
export class DrizzleMessageStore implements MessageStore {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /** The message takes the seq of its own `MessageSent` event, so inbox order is log order. */
  append(
    message: NewMessage,
    eventFor: (stored: MessageRecord) => RunEventDraft,
  ): Promise<Recorded<MessageRecord>> {
    return this.database.db.transaction(async (tx) => {
      const seq = await allocateSeqs(tx, message.runId, 1);
      const arrival = message.deliveredOnArrival ? new Date() : null;
      const [row] = await tx
        .insert(messages)
        .values({
          runId: message.runId,
          seq,
          fromAgent: message.from,
          toAgent: message.to,
          kind: message.kind,
          replyTo: message.replyTo,
          body: message.body,
          deliveredAt: arrival,
          ackedAt: arrival,
        })
        .returning();
      const record = toMessageRecord(row!);
      return { record, events: await insertEvents(tx, message.runId, seq, [eventFor(record)]) };
    });
  }

  async markDelivered(messageId: string): Promise<MessageRecord | undefined> {
    const [row] = await this.database.db
      .update(messages)
      .set({ deliveredAt: sql`coalesce(${messages.deliveredAt}, now())` })
      .where(eq(messages.id, messageId))
      .returning();
    return row && toMessageRecord(row);
  }

  markAcked(
    messageId: string,
    eventFor: (stored: MessageRecord) => RunEventDraft,
  ): Promise<Recorded<MessageRecord> | undefined> {
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(messages)
        .set({
          deliveredAt: sql`coalesce(${messages.deliveredAt}, now())`,
          ackedAt: sql`now()`,
        })
        .where(and(eq(messages.id, messageId), isNull(messages.ackedAt)))
        .returning();
      if (!row) return undefined;
      const record = toMessageRecord(row);
      return { record, events: await appendEvents(tx, record.runId, [eventFor(record)]) };
    });
  }

  async findById(messageId: string): Promise<MessageRecord | undefined> {
    const [row] = await this.database.db.select().from(messages).where(eq(messages.id, messageId));
    return row && toMessageRecord(row);
  }

  async findNextPending(runId: string, agent: string): Promise<MessageRecord | undefined> {
    const [row] = await this.database.db
      .select()
      .from(messages)
      .where(and(eq(messages.runId, runId), eq(messages.toAgent, agent), isNull(messages.ackedAt)))
      .orderBy(asc(messages.seq))
      .limit(1);
    return row && toMessageRecord(row);
  }

  async listUnacked(runId: string): Promise<MessageRecord[]> {
    const rows = await this.database.db
      .select()
      .from(messages)
      .where(and(eq(messages.runId, runId), isNull(messages.ackedAt)))
      .orderBy(asc(messages.seq));
    return rows.map(toMessageRecord);
  }
}
