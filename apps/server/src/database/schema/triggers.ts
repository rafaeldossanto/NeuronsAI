import { boolean, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "./columns.js";
import { graphs } from "./graphs.js";
import { runs } from "./runs.js";

/**
 * The runtime state of a graph's external trigger (a webhook or a schedule): whether it is on, the
 * opaque id of its public URL, when it last fired and when a schedule fires next. It lives apart
 * from the graph definition: versions are immutable, and turning a trigger on or off must not
 * publish a new version. The webhook's secret is in `secrets` (named after `hook_id`), never here.
 */
export const graphTriggers = pgTable(
  "graph_triggers",
  {
    graphId: uuid("graph_id")
      .notNull()
      .references(() => graphs.id, { onDelete: "cascade" }),
    /** The id of the trigger block inside the graph definition. */
    triggerId: text("trigger_id").notNull(),
    /** Random and opaque: it is the only thing that identifies the trigger on the public route. */
    hookId: text("hook_id").notNull().unique(),
    /** Off until the user turns it on. */
    enabled: boolean("enabled").notNull().default(false),
    /** When the webhook secret was last generated; null while it has none. */
    secretSetAt: timestamp("secret_set_at", { withTimezone: true }),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    /** `started`, `skipped_overlap`, `skipped_missed` or `failed`. */
    lastOutcome: text("last_outcome"),
    /** Why it was skipped or failed (pt-BR, never holds a secret or a request body). */
    lastNote: text("last_note"),
    /** The last run this trigger actually started. */
    lastRunId: uuid("last_run_id").references(() => runs.id, { onDelete: "set null" }),
    /** When the schedule fires next; null for a webhook or a trigger that is off. */
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.graphId, table.triggerId] })],
);

/**
 * Signatures of webhook requests already accepted, kept for the signature window so the same
 * request cannot be replayed. Rows older than the window are deleted.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    hookId: text("hook_id").notNull(),
    signature: text("signature").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.hookId, table.signature] })],
);

/**
 * WhatsApp messages already turned into runs, so that Meta resending the same message (it does,
 * for up to 7 days when it does not get a 200) starts nothing twice. It also remembers who to
 * answer: `contact` is the customer's number, **personal data**, kept only while a reply is
 * possible (the 24-hour window) and then cleared; the row itself, which holds no personal data,
 * stays for the whole period Meta may resend.
 */
export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    hookId: text("hook_id")
      .notNull()
      .references(() => graphTriggers.hookId, { onDelete: "cascade" }),
    /** The `wamid` Meta gave the message. */
    messageId: text("message_id").notNull(),
    /** The run the message started; null while it is being started (or when it could not be). */
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    /** The business number the customer wrote to. */
    phoneNumberId: text("phone_number_id").notNull(),
    /** The customer's number; cleared once the 24-hour window is over. */
    contact: text("contact"),
    /** When the customer sent the message (Meta's timestamp): the 24-hour window counts from here. */
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.hookId, table.messageId] }),
    index("whatsapp_messages_run_idx").on(table.runId),
  ],
);
