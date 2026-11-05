import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { GraphDefinition } from "@neurons/graph-schema";
import { createdAtColumn, idColumn } from "./columns.js";
import { organizations } from "./accounts.js";

export const graphs = pgTable(
  "graphs",
  {
    id: idColumn(),
    /** NULL preserves the existing account-free local workspace. */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** Work in progress edited by the user; may not be a valid graph yet. */
    draft: jsonb("draft").$type<unknown>(),
  },
  (table) => [index("graphs_organization_idx").on(table.organizationId)],
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
    definition: jsonb("definition").$type<GraphDefinition>().notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [unique("graph_versions_graph_id_version_unique").on(table.graphId, table.version)],
);
