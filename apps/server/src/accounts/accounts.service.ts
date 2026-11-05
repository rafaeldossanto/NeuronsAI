import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { DatabaseService, type DatabaseTransaction } from "../database/database.service.js";
import {
  identities,
  memberships,
  organizationInvitations,
  organizations,
  users,
  type OrganizationRole,
} from "../database/schema/accounts.js";
import {
  AccountNotFoundError,
  InvitationNotFoundError,
  LastOwnerError,
  OrganizationAccessError,
  SignupClosedError,
} from "./account.errors.js";
import type { VerifiedIdentity } from "./identity-provider.js";
import { normalizeEmail, SIGNUP_POLICY, type SignupPolicy } from "./signup-policy.js";
import { requireOrganizationAccess, type OrganizationPermission } from "./organization-access.js";

const identitySchema = z.object({
  issuer: z.url().max(2048),
  subject: z.string().min(1).max(255),
  displayName: z.string().trim().min(1).max(200),
  email: z.email().max(320).optional(),
});
const organizationName = z.string().trim().min(1).max(200);
const invitationEmail = z.email().max(320).transform(normalizeEmail);
const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const isPrivileged = (role: OrganizationRole | null | undefined) =>
  role === "owner" || role === "admin";
export type AccountUser = typeof users.$inferSelect;

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SIGNUP_POLICY) private readonly signup: SignupPolicy,
  ) {}

  /**
   * Called only after OIDC verification by a trusted adapter. Signup is an atomic transaction.
   * A new identity needs an invitation for its verified e-mail or a place in the signup allow-list
   * ({@link SignupPolicy}); otherwise nothing is created. Pending invitations for the verified
   * e-mail are redeemed on every login, for new and existing accounts alike.
   * @throws SignupClosedError
   */
  async provisionIdentity(identity: VerifiedIdentity): Promise<AccountUser> {
    const verified = identitySchema.parse(identity);
    const email = verified.email ? normalizeEmail(verified.email) : undefined;
    const existing = await this.findIdentity(verified);
    if (existing) {
      if (email) {
        await this.database.db.transaction((tx) => redeemInvitations(tx, existing.id, email));
      }
      return existing;
    }
    try {
      return await this.database.db.transaction(async (tx) => {
        const invited = email ? await pendingInvitations(tx, email) : [];
        const listed = this.signup.allows(email);
        if (!listed && invited.length === 0) throw new SignupClosedError();
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
        // Someone who is only invited joins the inviting organization, without a space of their own.
        if (listed) {
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
        }
        if (email) await redeemInvitations(tx, user!.id, email);
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

  /** An owner/admin invites an e-mail; the person gets the role at their first verified login. */
  async invite(
    actorId: string,
    organizationId: string,
    emailInput: string,
    role: OrganizationRole,
  ) {
    const email = invitationEmail.parse(emailInput);
    const actor = await this.requireAccess(actorId, organizationId, "manage_members");
    if (actor.role !== "owner" && isPrivileged(role)) throw new OrganizationAccessError();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const [invitation] = await this.database.db
      .insert(organizationInvitations)
      .values({ organizationId, email, role, invitedBy: actorId, expiresAt })
      .onConflictDoUpdate({
        target: [organizationInvitations.organizationId, organizationInvitations.email],
        set: { role, invitedBy: actorId, expiresAt },
      })
      .returning();
    return presentInvitation(invitation!);
  }

  async listInvitations(actorId: string, organizationId: string) {
    await this.requireAccess(actorId, organizationId, "manage_members");
    const rows = await this.database.db
      .select()
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, organizationId),
          gt(organizationInvitations.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(organizationInvitations.createdAt));
    return rows.map(presentInvitation);
  }

  async revokeInvitation(actorId: string, organizationId: string, invitationId: string) {
    const actor = await this.requireAccess(actorId, organizationId, "manage_members");
    const key = and(
      eq(organizationInvitations.id, invitationId),
      eq(organizationInvitations.organizationId, organizationId),
    );
    const [invitation] = await this.database.db.select().from(organizationInvitations).where(key);
    if (!invitation) throw new InvitationNotFoundError();
    if (actor.role !== "owner" && isPrivileged(invitation.role)) {
      throw new OrganizationAccessError();
    }
    await this.database.db.delete(organizationInvitations).where(key);
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

type Invitation = typeof organizationInvitations.$inferSelect;

function presentInvitation(invitation: Invitation) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

function pendingInvitations(db: Pick<DatabaseTransaction, "select">, email: string) {
  return db
    .select()
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.email, email),
        gt(organizationInvitations.expiresAt, new Date()),
      ),
    );
}

/** Turns the invitations of a verified e-mail into memberships (never lowering an existing role). */
async function redeemInvitations(tx: DatabaseTransaction, userId: string, email: string) {
  for (const invitation of await pendingInvitations(tx, email)) {
    await tx
      .insert(memberships)
      .values({ organizationId: invitation.organizationId, userId, role: invitation.role })
      .onConflictDoNothing();
  }
  // Expired invitations for the same e-mail are dropped along with the redeemed ones.
  await tx.delete(organizationInvitations).where(eq(organizationInvitations.email, email));
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}
