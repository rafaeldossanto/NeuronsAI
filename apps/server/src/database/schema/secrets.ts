import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { bytea, createdAtColumn } from "./columns.js";

/** AES-256-GCM encrypted values; plaintext never reaches the database. */
export const secrets = pgTable("secrets", {
  name: text("name").primaryKey(),
  ciphertext: bytea("ciphertext").notNull(),
  iv: bytea("iv").notNull(),
  authTag: bytea("auth_tag").notNull(),
  createdAt: createdAtColumn(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
