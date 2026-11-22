import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./accounts.js";
import { createdAtColumn, idColumn } from "./columns.js";
import { graphs } from "./graphs.js";

export const GRAPH_DELETION_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type GraphDeletionStatus = (typeof GRAPH_DELETION_STATUSES)[number];

/**
 * A member's request to delete a project, which an owner or admin approves or rejects. At most one
 * is pending per graph. It goes with the graph (cascade), so an approved request leaves no row:
 * the deletion itself is the record.
 */
export const graphDeletionRequests = pgTable(
  "graph_deletion_requests",
  {
    id: idColumn(),
    graphId: uuid("graph_id")
      .notNull()
      .references(() => graphs.id, { onDelete: "cascade" }),
    /** Same organization as the graph (NULL only in the account-free workspace, which never asks). */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").$type<GraphDeletionStatus>().notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("graph_deletion_requests_pending_unique")
      .on(table.graphId)
      .where(sql`${table.status} = 'pending'`),
    index("graph_deletion_requests_organization_idx").on(table.organizationId),
    check(
      "graph_deletion_requests_status_check",
      sql`${table.status} in ('pending', 'approved', 'rejected', 'cancelled')`,
    ),
  ],
);
