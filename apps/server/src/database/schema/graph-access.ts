import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./accounts.js";
import { createdAtColumn, idColumn } from "./columns.js";
import { graphs } from "./graphs.js";

export const GRAPH_ACCESS_STATUSES = ["granted", "blocked", "requested"] as const;
export type GraphAccessStatus = (typeof GRAPH_ACCESS_STATUSES)[number];
export const GRAPH_GRANT_LEVELS = ["use", "edit"] as const;
export type GraphGrantLevel = (typeof GRAPH_GRANT_LEVELS)[number];

/**
 * What the owner of a project decided about one person: let them in (`granted`, as "use" or
 * "edit"), shut them out (`blocked`, which also stops new requests) or what the person asked for
 * and waits on (`requested`). One row per person and project; refusing a request deletes the row.
 * It only matters while the project is `restricted`, except for `blocked`, which counts in both modes.
 */
export const graphAccess = pgTable(
  "graph_access",
  {
    id: idColumn(),
    graphId: uuid("graph_id")
      .notNull()
      .references(() => graphs.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").$type<GraphAccessStatus>().notNull(),
    /** Required when `granted`, absent otherwise. */
    level: text("level").$type<GraphGrantLevel>(),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique("graph_access_graph_user_unique").on(table.graphId, table.userId),
    // "What can this person see in this organization" and the cleanup when they leave it.
    index("graph_access_organization_user_idx").on(table.organizationId, table.userId),
    // The pending requests of a project (and the count shown on the list).
    index("graph_access_graph_status_idx").on(table.graphId, table.status),
    check("graph_access_status_check", sql`${table.status} in ('granted', 'blocked', 'requested')`),
    check("graph_access_level_check", sql`${table.level} in ('use', 'edit')`),
    check(
      "graph_access_level_matches_status_check",
      sql`(${table.status} = 'granted') = (${table.level} is not null)`,
    ),
  ],
);
