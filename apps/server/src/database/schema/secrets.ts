import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { bytea, createdAtColumn, idColumn } from "./columns.js";
import { organizations } from "./accounts.js";

/** AES-256-GCM encrypted values; plaintext never reaches the database. */
export const secrets = pgTable(
  "secrets",
  {
    id: idColumn(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    iv: bytea("iv").notNull(),
    authTag: bytea("auth_tag").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("secrets_organization_name_unique")
      .on(table.organizationId, table.name)
      .nullsNotDistinct(),
  ],
);
