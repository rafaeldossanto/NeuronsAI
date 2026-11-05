import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { accountSessions, refreshCredentials } from "../database/schema/accounts.js";
import { InvalidSessionError, OrganizationAccessError } from "./account.errors.js";
import { requireOrganizationAccess, type OrganizationScope } from "./organization-access.js";

const ACCESS_TTL_MS = 15 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export interface SessionCredentials {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  expiresAt: Date;
}

/**
 * Internal credential service. Web routes return only HttpOnly cookies, never token JSON.
 * Credentials are returned once to the trusted caller; only SHA-256 of random values is stored.
 */
export class AccountSessionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(userId: string, organizationId: string): Promise<SessionCredentials> {
    const tokens = newCredentials();
    const now = this.now();
    const accessExpiresAt = new Date(now.getTime() + ACCESS_TTL_MS);
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    return this.database.db.transaction(async (tx) => {
      await requireOrganizationAccess(tx, userId, organizationId);
      const [session] = await tx
        .insert(accountSessions)
        .values({
          userId,
          organizationId,
          accessTokenHash: digest(tokens.accessToken),
          accessExpiresAt,
          expiresAt,
        })
        .returning({ id: accountSessions.id });
      await tx.insert(refreshCredentials).values({
        sessionId: session!.id,
        tokenHash: digest(tokens.refreshToken),
      });
      return { sessionId: session!.id, ...tokens, accessExpiresAt, expiresAt };
    });
  }

  async authenticate(accessToken: string): Promise<OrganizationScope & { sessionId: string }> {
    checkToken(accessToken, "nsa");
    const [session] = await this.database.db
      .select()
      .from(accountSessions)
      .where(
        and(
          eq(accountSessions.accessTokenHash, digest(accessToken)),
          isNull(accountSessions.revokedAt),
        ),
      );
    const now = this.now();
    if (!session || session.accessExpiresAt <= now || session.expiresAt <= now)
      throw new InvalidSessionError();
    try {
      const scope = await requireOrganizationAccess(
        this.database.db,
        session.userId,
        session.organizationId,
      );
      return { ...scope, sessionId: session.id };
    } catch (error) {
      if (error instanceof OrganizationAccessError) throw new InvalidSessionError();
      throw error;
    }
  }

  async refresh(refreshToken: string): Promise<SessionCredentials> {
    checkToken(refreshToken, "nsr");
    const tokenHash = digest(refreshToken);
    const result = await this.database.db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ sessionId: refreshCredentials.sessionId })
        .from(refreshCredentials)
        .where(eq(refreshCredentials.tokenHash, tokenHash));
      if (!candidate) return null;
      // The session row serializes every refresh in the family. Read the credential again AFTER
      // acquiring this lock: a concurrent request may have just consumed it while we waited.
      const [session] = await tx
        .select()
        .from(accountSessions)
        .where(eq(accountSessions.id, candidate.sessionId))
        .for("update");
      if (!session || session.revokedAt) return null;
      const now = this.now();
      const [credential] = await tx
        .select()
        .from(refreshCredentials)
        .where(eq(refreshCredentials.tokenHash, tokenHash));
      if (!credential || session.expiresAt <= now) return null;
      if (credential.consumedAt) {
        // Return, don't throw inside the transaction: revocation MUST survive the rejected request.
        await tx
          .update(accountSessions)
          .set({ revokedAt: now })
          .where(eq(accountSessions.id, session.id));
        return null;
      }
      await requireOrganizationAccess(tx, session.userId, session.organizationId);
      const tokens = newCredentials();
      const accessExpiresAt = new Date(
        Math.min(now.getTime() + ACCESS_TTL_MS, session.expiresAt.getTime()),
      );
      await tx
        .update(refreshCredentials)
        .set({ consumedAt: now })
        .where(eq(refreshCredentials.tokenHash, tokenHash));
      await tx
        .update(accountSessions)
        .set({ accessTokenHash: digest(tokens.accessToken), accessExpiresAt })
        .where(eq(accountSessions.id, session.id));
      await tx
        .insert(refreshCredentials)
        .values({ sessionId: session.id, tokenHash: digest(tokens.refreshToken) });
      return { sessionId: session.id, ...tokens, accessExpiresAt, expiresAt: session.expiresAt };
    });
    if (!result) throw new InvalidSessionError();
    return result;
  }

  /** Any known refresh credential permits logout of its own session, including after expiry. */
  async revoke(refreshToken: string): Promise<void> {
    checkToken(refreshToken, "nsr");
    const [credential] = await this.database.db
      .select()
      .from(refreshCredentials)
      .where(eq(refreshCredentials.tokenHash, digest(refreshToken)));
    if (!credential) return;
    await this.database.db
      .update(accountSessions)
      .set({ revokedAt: this.now() })
      .where(eq(accountSessions.id, credential.sessionId));
  }
}

function newCredentials() {
  return {
    accessToken: `nsa_${randomBytes(32).toString("base64url")}`,
    refreshToken: `nsr_${randomBytes(32).toString("base64url")}`,
  };
}

function checkToken(token: string, prefix: "nsa" | "nsr"): void {
  if (typeof token !== "string" || !new RegExp(`^${prefix}_[A-Za-z0-9_-]{43}$`).test(token))
    throw new InvalidSessionError();
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
