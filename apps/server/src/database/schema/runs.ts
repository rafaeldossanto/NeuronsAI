import { bigint, check, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { idColumn } from "./columns.js";
import { graphVersions } from "./graphs.js";

export const RUN_STATUSES = ["pending", "running", "succeeded", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

const usd = (name: string) => numeric(name, { precision: 14, scale: 6 });

export const runs = pgTable(
  "runs",
  {
    id: idColumn(),
    graphVersionId: uuid("graph_version_id")
      .notNull()
      .references(() => graphVersions.id, { onDelete: "restrict" }),
    status: text("status").$type<RunStatus>().notNull().default("pending"),
    /** Null means "no spending limit". */
    budgetUsd: usd("budget_usd"),
    spentUsd: usd("spent_usd").notNull().default("0"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /**
     * Last `run_events.seq` handed out. Events take their seq with a single
     * `UPDATE ... SET last_seq = last_seq + n RETURNING`, which serializes concurrent writers
     * of the same run, so seqs never repeat nor leave gaps.
     */
    lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    check(
      "runs_status_check",
      sql`${table.status} in (${sql.join(
        RUN_STATUSES.map((status) => sql.raw(`'${status}'`)),
        sql`, `,
      )})`,
    ),
  ],
);
