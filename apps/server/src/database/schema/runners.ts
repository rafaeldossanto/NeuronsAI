import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn } from "./columns.js";
import { organizations, users } from "./accounts.js";

/**
 * The runners allowed to connect (T24). The token itself is never stored, only its SHA-256: it is a
 * long random secret, so a fast hash is enough and a leaked table does not let anyone connect.
 */
export const runners = pgTable(
  "runners",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    /** Null is a runner of the organization; set is the personal runner of that user. */
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: createdAtColumn(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    /** Set when the token is revoked: a revoked runner is refused and a connected one is dropped. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("runners_organization_owner_name_unique")
      .on(table.organizationId, table.ownerUserId, table.name)
      .nullsNotDistinct(),
  ],
);
