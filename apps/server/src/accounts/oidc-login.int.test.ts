import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loginAttempts } from "../database/schema/login-attempts.js";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { AesGcmSecretCipher } from "../secrets/secret-cipher.js";
import { AccountsService } from "./accounts.service.js";
import { AccountSessionsService } from "./account-sessions.service.js";
import { BrowserSession } from "./browser-session.js";
import type { IdentityProvider } from "./identity-provider.js";
import { LoginAttemptError, IdentityVerificationError } from "./login.errors.js";
import { OidcLoginService } from "./oidc-login.service.js";

let database: TestDatabase;
let sessions: AccountSessionsService;
let login: OidcLoginService;
let now: Date;
let exchanges: Parameters<IdentityProvider["exchange"]>[0][];
let fail = false;
const origin = "https://neurons.example.invalid";
const redirectUri = `${origin}/auth/google/callback`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const provider: IdentityProvider = {
  authorizationUrl: (input) =>
    new URL(`${origin}/provider?${new URLSearchParams(input).toString()}`),
  exchange: (input) => {
    exchanges.push(input);
    if (fail) return Promise.reject(new IdentityVerificationError());
    return Promise.resolve({
      issuer: "https://issuer.example.invalid",
      subject: "login-subject",
      displayName: "Pessoa",
    });
  },
};
beforeAll(async () => {
  database = await startTestDatabase();
});
afterAll(async () => {
  await database?.stop();
});
beforeEach(() => {
  now = new Date("2026-11-05T12:00:00Z");
  exchanges = [];
  fail = false;
  sessions = new AccountSessionsService(database.database, () => now);
  login = new OidcLoginService(
    database.database,
    new AccountsService(database.database),
    sessions,
    provider,
    new AesGcmSecretCipher(randomBytes(32)),
    redirectUri,
    () => now,
  );
});
const stateOf = (attempt: { authorizationUrl: string }) =>
  new URL(attempt.authorizationUrl).searchParams.get("state")!;
const callback = (attempt: { authorizationUrl: string; binding: string }) => ({
  state: stateOf(attempt),
  binding: attempt.binding,
  code: "code",
});

describe("retorno OIDC persistente e de uso único", () => {
  it("liga state ao navegador e guarda o verifier cifrado, sem tokens do Google", async () => {
    const attempt = await login.begin();
    const [stored] = await database.database.db
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.stateHash, hash(stateOf(attempt))));
    expect(stored!.bindingHash).toBe(hash(attempt.binding));
    expect(JSON.stringify(stored)).not.toContain(attempt.binding);
    const credentials = await login.complete(callback(attempt));
    expect(exchanges).toHaveLength(1);
    expect(createHash("sha256").update(exchanges[0]!.codeVerifier).digest("base64url")).toBe(
      new URL(attempt.authorizationUrl).searchParams.get("codeChallenge"),
    );
    expect(await sessions.authenticate(credentials.accessToken)).toMatchObject({ role: "owner" });
    await expect(login.complete(callback(attempt))).rejects.toThrow(LoginAttemptError);
  });

  it("recusa outro navegador sem consumir a tentativa legítima", async () => {
    const attempt = await login.begin();
    await expect(login.complete({ ...callback(attempt), binding: "x".repeat(43) })).rejects.toThrow(
      LoginAttemptError,
    );
    expect(exchanges).toHaveLength(0);
    await expect(login.complete(callback(attempt))).resolves.toHaveProperty("accessToken");
  });

  it("recusa tentativa expirada e callbacks malformados", async () => {
    const attempt = await login.begin();
    now = attempt.expiresAt;
    await expect(login.complete(callback(attempt))).rejects.toThrow(LoginAttemptError);
    await expect(
      login.complete({ state: "invalid", binding: attempt.binding, code: "code" }),
    ).rejects.toThrow(LoginAttemptError);
    expect(exchanges).toHaveLength(0);
  });

  it("apenas um callback concorrente troca o código", async () => {
    const attempt = await login.begin();
    const outcomes = await Promise.allSettled([
      login.complete(callback(attempt)),
      login.complete(callback(attempt)),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(exchanges).toHaveLength(1);
  });

  it("consome state mesmo se o provedor recusar o código", async () => {
    const attempt = await login.begin();
    fail = true;
    await expect(login.complete(callback(attempt))).rejects.toThrow(IdentityVerificationError);
    fail = false;
    await expect(login.complete(callback(attempt))).rejects.toThrow(LoginAttemptError);
  });
});

describe("transporte de sessão web", () => {
  const cookieHeader = (cookies: string[]) =>
    cookies.map((cookie) => cookie.split(";")[0]).join("; ");
  async function signedIn() {
    const attempt = await login.begin();
    const credentials = await login.complete(callback(attempt));
    const browser = new BrowserSession(sessions, origin);
    const cookies = browser.setCredentials(credentials);
    const csrf = cookies
      .find((cookie) => cookie.startsWith("__Host-neurons-csrf="))!
      .split(";")[0]!
      .split("=")[1]!;
    return {
      browser,
      credentials,
      cookies,
      request: { headers: { origin, cookie: cookieHeader(cookies), "x-neurons-csrf": csrf } },
    };
  }

  it("mantém acesso/renovação HttpOnly e Secure, sem Domain e sem tokens no JSON", async () => {
    const { browser, credentials, cookies, request } = await signedIn();
    expect(
      cookies
        .slice(0, 2)
        .every(
          (cookie) =>
            cookie.includes("; HttpOnly") &&
            cookie.includes("; Secure") &&
            cookie.includes("Path=/"),
        ),
    ).toBe(true);
    expect(cookies.every((cookie) => !cookie.includes("Domain="))).toBe(true);
    expect(await browser.authenticate(request)).toMatchObject({ sessionId: credentials.sessionId });
    expect(JSON.stringify(await browser.authenticate(request))).not.toContain(
      credentials.refreshToken,
    );
  });

  it("renova com Origin + CSRF e recusa cross-origin, falta de token e cookies ambíguos", async () => {
    const { browser, request } = await signedIn();
    await expect(
      browser.refresh({ headers: { ...request.headers, origin: "https://evil.invalid" } }),
    ).rejects.toThrow();
    await expect(
      browser.refresh({ headers: { ...request.headers, "x-neurons-csrf": "" } }),
    ).rejects.toThrow();
    await expect(
      browser.refresh({
        headers: {
          ...request.headers,
          cookie: `${request.headers.cookie}; __Host-neurons-csrf=duplicate`,
        },
      }),
    ).rejects.toThrow();
    const renewed = await browser.refresh(request);
    await expect(
      browser.authenticate({ headers: { cookie: cookieHeader(renewed) } }),
    ).resolves.toHaveProperty("userId");
  });

  it("logout revoga a sessão e limpa todos os cookies", async () => {
    const { browser, credentials, request } = await signedIn();
    const cleared = await browser.logout(request);
    expect(cleared).toHaveLength(4);
    expect(cleared.every((cookie) => cookie.includes("Expires=Thu, 01 Jan 1970"))).toBe(true);
    await expect(sessions.authenticate(credentials.accessToken)).rejects.toThrow();
  });

  it("liga o callback ao cookie HttpOnly e permite HTTP apenas em loopback", async () => {
    const attempt = await login.begin();
    const browser = new BrowserSession(sessions, origin);
    const cookie = browser.loginCookie(attempt.binding, attempt.expiresAt);
    expect(cookie).toContain("SameSite=Lax; Secure; HttpOnly");
    expect(browser.loginBinding({ headers: { cookie: cookieHeader([cookie]) } })).toBe(
      attempt.binding,
    );
    expect(() => browser.loginBinding({ headers: {} })).toThrow(LoginAttemptError);
    expect(() => new BrowserSession(sessions, "http://public.example.invalid")).toThrow();
    expect(() => new BrowserSession(sessions, "http://127.0.0.1:3100")).not.toThrow();
  });
});
