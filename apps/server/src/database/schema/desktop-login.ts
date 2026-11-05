import { foreignKey, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { memberships } from "./accounts.js";
import { createdAtColumn } from "./columns.js";

/** The public native-app challenge and fixed loopback return associated with browser OIDC state. */
export const desktopLoginAttempts = pgTable("desktop_login_attempts", {
  stateHash: text("state_hash").primaryKey(),
  clientState: text("client_state").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAtColumn(),
});

/** A one-minute, single-use code. No access or refresh credentials are stored in the handoff. */
export const desktopLoginGrants = pgTable(
  "desktop_login_grants",
  {
    codeHash: text("code_hash").primaryKey(),
    codeChallenge: text("code_challenge").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    userId: uuid("user_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({
      name: "desktop_login_grants_membership_fk",
      columns: [table.organizationId, table.userId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }).onDelete("cascade"),
  ],
);
