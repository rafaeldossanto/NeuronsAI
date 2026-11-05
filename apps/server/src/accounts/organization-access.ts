import { and, eq } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "../database/database.service.js";
import { memberships, type OrganizationRole } from "../database/schema/accounts.js";
import { OrganizationAccessError } from "./account.errors.js";

export type OrganizationPermission = "read" | "write" | "manage_members" | "manage_credentials";
export interface OrganizationScope {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
}

const permissions: Record<OrganizationRole, readonly OrganizationPermission[]> = {
  owner: ["read", "write", "manage_members", "manage_credentials"],
  admin: ["read", "write", "manage_members", "manage_credentials"],
  member: ["read", "write"],
  viewer: ["read"],
};

/** Always re-read membership; a previously resolved scope is not a long-lived authorization. */
export async function requireOrganizationAccess(
  db: Database | DatabaseTransaction,
  userId: string,
  organizationId: string,
  permission: OrganizationPermission = "read",
): Promise<OrganizationScope> {
  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)));
  if (!membership || !permissions[membership.role].includes(permission))
    throw new OrganizationAccessError();
  return { userId, organizationId, role: membership.role };
}
