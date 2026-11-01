import { bigint, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { runs } from "./runs.js";

/** Append-only log of everything that happens in a run (updates are rejected by a trigger). */
export const runEvents = pgTable(
  "run_events",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    /** Monotonic per run; clients resume from it after a reconnection. */
    seq: bigint("seq", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    agent: text("agent"),
    payload: jsonb("payload").$type<unknown>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "run_events_run_id_seq_pk", columns: [table.runId, table.seq] })],
);
