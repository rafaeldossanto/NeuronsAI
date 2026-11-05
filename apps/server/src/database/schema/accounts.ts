import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn } from "./columns.js";

export const ORGANIZATION_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const users = pgTable("users", {
  id: idColumn(),
  displayName: text("display_name").notNull(),
  // Contact information only. Accounts are identified by issuer + subject, never by email.
  email: text("email"),
  createdAt: createdAtColumn(),
});

export const identities = pgTable(
  "identities",
  {
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.issuer, table.subject] }),
    index("identities_user_idx").on(table.userId),
  ],
);

export const organizations = pgTable("organizations", {
  id: idColumn(),
  name: text("name").notNull(),
  createdAt: createdAtColumn(),
});

export const memberships = pgTable(
  "organization_memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<OrganizationRole>().notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index("organization_memberships_user_idx").on(table.userId),
    check(
      "organization_memberships_role_check",
      sql`${table.role} in ('owner', 'admin', 'member', 'viewer')`,
    ),
  ],
);

/** One session is bound to one organization. Only opaque token hashes reach storage. */
export const accountSessions = pgTable(
  "account_sessions",
  {
    id: idColumn(),
    userId: uuid("user_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    accessTokenHash: text("access_token_hash").notNull().unique(),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({
      name: "account_sessions_membership_fk",
      columns: [table.organizationId, table.userId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }).onDelete("cascade"),
    index("account_sessions_membership_idx").on(table.organizationId, table.userId),
    check("account_sessions_expiry_check", sql`${table.accessExpiresAt} <= ${table.expiresAt}`),
  ],
);

/** Consumed credentials remain until the session is removed, allowing replay detection. */
export const refreshCredentials = pgTable(
  "refresh_credentials",
  {
    tokenHash: text("token_hash").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => accountSessions.id, { onDelete: "cascade" }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (table) => [index("refresh_credentials_session_idx").on(table.sessionId)],
);
