import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { GraphDefinition } from "@neurons/graph-schema";
import { createdAtColumn, idColumn } from "./columns.js";
import { organizations, users } from "./accounts.js";

export const GRAPH_ACCESS_MODES = ["organization", "restricted"] as const;
export type GraphAccessMode = (typeof GRAPH_ACCESS_MODES)[number];

export const graphs = pgTable(
  "graphs",
  {
    id: idColumn(),
    /** NULL preserves the existing account-free local workspace. */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    /**
     * Who created the project through a signed-in session; NULL in the account-free workspace and
     * for projects that existed before per-project access. The owner always has full access.
     */
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    /**
     * `organization`: every member has the access their role gives (the way projects always worked).
     * `restricted`: only the owner, owners/admins of the organization and the people in `graph_access`.
     */
    accessMode: text("access_mode").$type<GraphAccessMode>().notNull().default("organization"),
    createdAt: createdAtColumn(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** Work in progress edited by the user; may not be a valid graph yet. */
    draft: jsonb("draft").$type<unknown>(),
  },
  (table) => [
    index("graphs_organization_idx").on(table.organizationId),
    check("graphs_access_mode_check", sql`${table.accessMode} in ('organization', 'restricted')`),
  ],
);

/** Immutable once written (enforced by a trigger, see the `immutable_tables` migration). */
export const graphVersions = pgTable(
  "graph_versions",
  {
    id: idColumn(),
    graphId: uuid("graph_id")
      .notNull()
      .references(() => graphs.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    credentialsApproved: boolean("credentials_approved").notNull().default(false),
    definition: jsonb("definition").$type<GraphDefinition>().notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [unique("graph_versions_graph_id_version_unique").on(table.graphId, table.version)],
);
