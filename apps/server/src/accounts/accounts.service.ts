import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import {
  identities,
  memberships,
  organizations,
  users,
  type OrganizationRole,
} from "../database/schema/accounts.js";
import { AccountNotFoundError, LastOwnerError, OrganizationAccessError } from "./account.errors.js";
import type { VerifiedIdentity } from "./identity-provider.js";
import { requireOrganizationAccess, type OrganizationPermission } from "./organization-access.js";

const identitySchema = z.object({
  issuer: z.url().max(2048),
  subject: z.string().min(1).max(255),
  displayName: z.string().trim().min(1).max(200),
  email: z.email().max(320).optional(),
});
const organizationName = z.string().trim().min(1).max(200);
export type AccountUser = typeof users.$inferSelect;

@Injectable()
export class AccountsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /** Called only after OIDC verification by a trusted adapter. Signup is an atomic transaction. */
  async provisionIdentity(identity: VerifiedIdentity): Promise<AccountUser> {
    const verified = identitySchema.parse(identity);
    const existing = await this.findIdentity(verified);
    if (existing) return existing;
    try {
      return await this.database.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            displayName: verified.displayName,
            email: verified.email ?? null,
          })
          .returning();
        await tx.insert(identities).values({
          issuer: verified.issuer,
          subject: verified.subject,
          userId: user!.id,
        });
        const [organization] = await tx
          .insert(organizations)
          .values({
            name: `Espaço de ${verified.displayName}`,
          })
          .returning();
        await tx.insert(memberships).values({
          organizationId: organization!.id,
          userId: user!.id,
          role: "owner",
        });
        return user!;
      });
    } catch (error) {
      // A concurrent signup may have won the unique issuer/subject key. Its transaction has
      // committed before ours reports the conflict; our user + organization were rolled back.
      if (isUniqueViolation(error)) {
        const winner = await this.findIdentity(verified);
        if (winner) return winner;
      }
      throw error;
    }
  }

  listOrganizations(userId: string) {
    return this.database.db
      .select({
        id: organizations.id,
        name: organizations.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(organizations.createdAt));
  }

  async createOrganization(userId: string, name: string) {
    const parsedName = organizationName.parse(name);
    return this.database.db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(organizations)
        .values({ name: parsedName })
        .returning();
      await tx.insert(memberships).values({
        organizationId: organization!.id,
        userId,
        role: "owner",
      });
      return organization!;
    });
  }

  requireAccess(userId: string, organizationId: string, permission?: OrganizationPermission) {
    return requireOrganizationAccess(this.database.db, userId, organizationId, permission);
  }

  async listMembers(userId: string, organizationId: string) {
    await this.requireAccess(userId, organizationId);
    return this.database.db
      .select({ userId: users.id, displayName: users.displayName, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, organizationId))
      .orderBy(asc(memberships.createdAt));
  }

  /** Null removes membership. An admin manages member/viewer roles; only owners manage admins. */
  async setMember(
    actorId: string,
    organizationId: string,
    userId: string,
    role: OrganizationRole | null,
  ) {
    return this.database.db.transaction(async (tx) => {
      // Serialize changes to the organization so two owners cannot remove each other concurrently.
      await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .for("update");
      const actor = await requireOrganizationAccess(tx, actorId, organizationId, "manage_members");
      const key = and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, userId),
      );
      const [current] = await tx.select().from(memberships).where(key);
      const privileged = (value: OrganizationRole | null | undefined) =>
        value === "owner" || value === "admin";
      if (actor.role !== "owner" && (privileged(current?.role) || privileged(role)))
        throw new OrganizationAccessError();
      if (current?.role === "owner" && role !== "owner") {
        const [owners] = await tx
          .select({ total: count() })
          .from(memberships)
          .where(
            and(eq(memberships.organizationId, organizationId), eq(memberships.role, "owner")),
          );
        if (owners!.total <= 1) throw new LastOwnerError();
      }
      if (role === null) {
        // The composite session FK cascades: rejoining later cannot revive an old session.
        await tx.delete(memberships).where(key);
      } else {
        const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
        if (!user) throw new AccountNotFoundError();
        await tx
          .insert(memberships)
          .values({ organizationId, userId, role })
          .onConflictDoUpdate({
            target: [memberships.organizationId, memberships.userId],
            set: { role },
          });
      }
    });
  }

  private async findIdentity(
    identity: Pick<VerifiedIdentity, "issuer" | "subject">,
  ): Promise<AccountUser | undefined> {
    const [row] = await this.database.db
      .select({ user: users })
      .from(identities)
      .innerJoin(users, eq(users.id, identities.userId))
      .where(and(eq(identities.issuer, identity.issuer), eq(identities.subject, identity.subject)));
    return row?.user;
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}
