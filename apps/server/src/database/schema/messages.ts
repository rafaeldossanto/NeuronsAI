import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn } from "./columns.js";
import { runs } from "./runs.js";

export const MESSAGE_KINDS = ["message", "ask", "reply"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const messages = pgTable(
  "messages",
  {
    id: idColumn(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    /** Seq of the `MessageSent` event: the delivery order (FIFO) of the run's messages. */
    seq: bigint("seq", { mode: "number" }).notNull(),
    fromAgent: text("from_agent").notNull(),
    toAgent: text("to_agent").notNull(),
    kind: text("kind").$type<MessageKind>().notNull(),
    replyTo: uuid("reply_to").references((): AnyPgColumn => messages.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt: createdAtColumn(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
  },
  (table) => [
    unique("messages_run_id_seq_unique").on(table.runId, table.seq),
    // Inbox lookup: what is still unacknowledged for an agent in a run.
    index("messages_inbox_idx").on(table.runId, table.toAgent, table.ackedAt),
    check(
      "messages_kind_check",
      sql`${table.kind} in (${sql.join(
        MESSAGE_KINDS.map((kind) => sql.raw(`'${kind}'`)),
        sql`, `,
      )})`,
    ),
  ],
);
