import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import { DatabaseService } from "../database/database.service.js";
import { loginAttempts } from "../database/schema/login-attempts.js";
import type { SecretCipher } from "../secrets/secret-cipher.js";
import { AccountsService } from "./accounts.service.js";
import { AccountSessionsService, type SessionCredentials } from "./account-sessions.service.js";
import type { IdentityProvider } from "./identity-provider.js";
import { LoginAttemptError } from "./login.errors.js";

const ATTEMPT_TTL_MS = 10 * 60_000;
const opaque = () => randomBytes(32).toString("base64url");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const isOpaque = (value: string) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

/** Browser receives only state + authorization URL, with binding kept in an HttpOnly cookie. */
export class OidcLoginService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accounts: AccountsService,
    private readonly sessions: AccountSessionsService,
    private readonly provider: IdentityProvider,
    private readonly cipher: SecretCipher,
    private readonly redirectUri: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async begin(): Promise<{
    authorizationUrl: string;
    binding: string;
    expiresAt: Date;
    state: string;
  }> {
    const state = opaque(),
      binding = opaque(),
      codeVerifier = opaque(),
      nonce = opaque();
    const stateHash = digest(state);
    const expiresAt = new Date(this.now().getTime() + ATTEMPT_TTL_MS);
    const encrypted = this.cipher.encrypt(codeVerifier, `oidc:${stateHash}`);
    const authorizationUrl = this.provider
      .authorizationUrl({
        state,
        nonce,
        codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
        redirectUri: this.redirectUri,
      })
      .toString();
    await this.database.db.delete(loginAttempts).where(lte(loginAttempts.expiresAt, this.now()));
    await this.database.db.insert(loginAttempts).values({
      stateHash,
      bindingHash: digest(binding),
      nonce,
      ...encrypted,
      expiresAt,
    });
    return { authorizationUrl, binding, expiresAt, state };
  }

  async complete(input: {
    state: string;
    binding: string;
    code: string;
  }): Promise<SessionCredentials> {
    const account = await this.verify(input);
    return this.sessions.issue(account.userId, account.organizationId);
  }

  /** Verification shared by web cookies and the PKCE-bound native handoff. */
  async verify(input: {
    state: string;
    binding: string;
    code: string;
  }): Promise<{ userId: string; organizationId: string }> {
    if (
      !isOpaque(input.state) ||
      !isOpaque(input.binding) ||
      !input.code ||
      input.code.length > 4096
    )
      throw new LoginAttemptError();
    // DELETE RETURNING atomically consumes state across concurrent callbacks/replicas.
    const [attempt] = await this.database.db
      .delete(loginAttempts)
      .where(
        and(
          eq(loginAttempts.stateHash, digest(input.state)),
          eq(loginAttempts.bindingHash, digest(input.binding)),
          gt(loginAttempts.expiresAt, this.now()),
        ),
      )
      .returning();
    if (!attempt) throw new LoginAttemptError();
    const codeVerifier = this.cipher.decrypt(attempt, `oidc:${attempt.stateHash}`);
    const identity = await this.provider.exchange({
      code: input.code,
      codeVerifier,
      nonce: attempt.nonce,
      redirectUri: this.redirectUri,
    });
    const user = await this.accounts.provisionIdentity(identity);
    const organization = (await this.accounts.listOrganizations(user.id))[0];
    // An account whose membership was removed must not receive a session to an arbitrary org.
    if (!organization) throw new LoginAttemptError();
    return { userId: user.id, organizationId: organization.id };
  }

  async cancel(state: string, binding: string): Promise<void> {
    if (!isOpaque(state) || !isOpaque(binding)) throw new LoginAttemptError();
    const rows = await this.database.db
      .delete(loginAttempts)
      .where(
        and(
          eq(loginAttempts.stateHash, digest(state)),
          eq(loginAttempts.bindingHash, digest(binding)),
          gt(loginAttempts.expiresAt, this.now()),
        ),
      )
      .returning({ stateHash: loginAttempts.stateHash });
    if (!rows.length) throw new LoginAttemptError();
  }
}
