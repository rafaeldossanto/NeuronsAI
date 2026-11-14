import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { bytea, createdAtColumn } from "./columns.js";

/** Short-lived, browser-bound, single-use OIDC state. PKCE verifier is encrypted at rest. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    stateHash: text("state_hash").primaryKey(),
    bindingHash: text("binding_hash").notNull(),
    nonce: text("nonce").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    iv: bytea("iv").notNull(),
    authTag: bytea("auth_tag").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  // The purge of expired attempts.
  (table) => [index("login_attempts_expires_at_idx").on(table.expiresAt)],
);
