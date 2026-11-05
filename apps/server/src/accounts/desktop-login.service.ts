import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, lte } from "drizzle-orm";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import { desktopLoginAttempts, desktopLoginGrants } from "../database/schema/desktop-login.js";
import { AccountAuth } from "./account-auth.service.js";
import { SignupClosedError } from "./account.errors.js";
import { LoginAttemptError } from "./login.errors.js";

const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
// Literal loopback only: no DNS names, arbitrary paths, credentials, fragments or query strings.
export const desktopRedirectUri = z
  .string()
  .regex(/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/neurons\/callback$/)
  .refine((value) => {
    const port = /^http:\/\/127\.0\.0\.1:(\d+)\//.exec(value)?.[1];
    return port !== undefined && Number(port) <= 65535;
  });
export const desktopBegin = z.object({
  redirectUri: desktopRedirectUri,
  state: opaque,
  codeChallenge: opaque,
});
export const desktopExchange = z.object({
  redirectUri: desktopRedirectUri,
  code: opaque,
  codeVerifier: opaque,
});
export const desktopCredentials = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: z.string(),
  expiresAt: z.string(),
});
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const challenge = (value: string) => createHash("sha256").update(value).digest("base64url");

@Injectable()
export class DesktopLoginService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AccountAuth) private readonly auth: AccountAuth,
  ) {}

  async begin(input: z.infer<typeof desktopBegin>) {
    const body = desktopBegin.parse(input);
    const attempt = await this.auth.require().login.begin();
    await this.database.db
      .delete(desktopLoginAttempts)
      .where(lte(desktopLoginAttempts.expiresAt, new Date()));
    await this.database.db
      .delete(desktopLoginGrants)
      .where(lte(desktopLoginGrants.expiresAt, new Date()));
    await this.database.db.insert(desktopLoginAttempts).values({
      stateHash: digest(attempt.state),
      clientState: body.state,
      redirectUri: body.redirectUri,
      codeChallenge: body.codeChallenge,
      expiresAt: attempt.expiresAt,
    });
    return attempt;
  }

  async find(state: string) {
    if (!opaque.safeParse(state).success) return undefined;
    const [attempt] = await this.database.db
      .select()
      .from(desktopLoginAttempts)
      .where(eq(desktopLoginAttempts.stateHash, digest(state)));
    return attempt;
  }

  async complete(input: { state: string; binding: string; code: string }): Promise<string> {
    let account;
    try {
      account = await this.auth.require().login.verify(input);
    } catch (error) {
      if (error instanceof SignupClosedError) return this.refuse(input.state, "signup_closed");
      throw error;
    }
    const code = randomBytes(32).toString("base64url");
    const attempt = await this.database.db.transaction(async (tx) => {
      const [pending] = await tx
        .delete(desktopLoginAttempts)
        .where(
          and(
            eq(desktopLoginAttempts.stateHash, digest(input.state)),
            gt(desktopLoginAttempts.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!pending) throw new LoginAttemptError();
      await tx.insert(desktopLoginGrants).values({
        codeHash: digest(code),
        codeChallenge: pending.codeChallenge,
        redirectUri: pending.redirectUri,
        ...account,
        expiresAt: new Date(Date.now() + 60_000),
      });
      return pending;
    });
    const url = new URL(attempt.redirectUri);
    url.searchParams.set("code", code);
    url.searchParams.set("state", attempt.clientState);
    return url.href;
  }

  async cancel(state: string, binding: string): Promise<string> {
    await this.auth.require().login.cancel(state, binding);
    return this.refuse(state, "access_denied");
  }

  /** Ends the native attempt and sends the browser back to the app saying why it did not get in. */
  private async refuse(state: string, reason: "access_denied" | "signup_closed"): Promise<string> {
    const [attempt] = await this.database.db
      .delete(desktopLoginAttempts)
      .where(eq(desktopLoginAttempts.stateHash, digest(state)))
      .returning();
    if (!attempt) throw new LoginAttemptError();
    const url = new URL(attempt.redirectUri);
    url.searchParams.set("state", attempt.clientState);
    url.searchParams.set("error", reason);
    return url.href;
  }

  async exchange(input: z.infer<typeof desktopExchange>) {
    this.auth.require();
    const body = desktopExchange.parse(input);
    const [grant] = await this.database.db
      .delete(desktopLoginGrants)
      .where(
        and(
          eq(desktopLoginGrants.codeHash, digest(body.code)),
          eq(desktopLoginGrants.codeChallenge, challenge(body.codeVerifier)),
          eq(desktopLoginGrants.redirectUri, body.redirectUri),
          gt(desktopLoginGrants.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!grant) throw new LoginAttemptError();
    const credentials = await this.auth.sessions.issue(grant.userId, grant.organizationId);
    return {
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      accessExpiresAt: credentials.accessExpiresAt.toISOString(),
      expiresAt: credentials.expiresAt.toISOString(),
    };
  }
}
