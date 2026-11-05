import { createHash, randomBytes } from "node:crypto";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { count, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApi } from "../api/testing/test-api.js";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { accountSessions } from "../database/schema/accounts.js";
import { desktopLoginAttempts, desktopLoginGrants } from "../database/schema/desktop-login.js";
import { AesGcmSecretCipher } from "../secrets/secret-cipher.js";
import { testConfig } from "../shared/config/testing/test-config.js";
import { AccountAuth } from "./account-auth.service.js";
import { AccountSessionsService } from "./account-sessions.service.js";
import { AccountsService } from "./accounts.service.js";
import { BrowserSession } from "./browser-session.js";
import { OidcLoginService } from "./oidc-login.service.js";

let database: TestDatabase, app: NestFastifyApplication, sessions: AccountSessionsService;
let sequence = 0;
const origin = "https://neurons.example.invalid";
const redirectUri = "http://127.0.0.1:45678/neurons/callback";
const verifier = "v".repeat(43),
  state = "s".repeat(43);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const beginQuery = (returnUri = redirectUri) =>
  new URLSearchParams({
    redirectUri: returnUri,
    state,
    codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
  }).toString();
beforeAll(async () => {
  Logger.overrideLogger(false);
  database = await startTestDatabase();
});
afterAll(async () => {
  await database?.stop();
});
beforeEach(async () => {
  const config = testConfig({
    auth: {
      publicOrigin: origin,
      google: {
        clientId: "native-test",
        clientSecret: "placeholder",
        redirectUri: `${origin}/auth/google/callback`,
      },
    },
  });
  const accounts = new AccountsService(database.database);
  sessions = new AccountSessionsService(database.database);
  const browser = new BrowserSession(sessions, origin),
    subject = `native-${++sequence}`;
  const login = new OidcLoginService(
    database.database,
    accounts,
    sessions,
    {
      authorizationUrl: (input) =>
        new URL(`https://accounts.google.com/authorize?${new URLSearchParams(input).toString()}`),
      exchange: () =>
        Promise.resolve({
          issuer: "https://identity.invalid",
          subject,
          displayName: "Pessoa de teste",
        }),
    },
    new AesGcmSecretCipher(randomBytes(32)),
    config.auth!.google.redirectUri,
  );
  const auth = {
    config,
    browser,
    login,
    sessions,
    require: () => ({ browser, login }),
  } as AccountAuth;
  app = await startTestApi(database, { config, auth });
});
afterEach(async () => {
  await app?.close();
});

async function begin() {
  const response = await app.inject({ method: "GET", url: `/auth/desktop?${beginQuery()}` });
  expect(response.statusCode).toBe(302);
  const oidcState = new URL(response.headers.location!).searchParams.get("state")!;
  const cookie = String(response.headers["set-cookie"]).split(";")[0]!;
  return { oidcState, cookie, callback: `/auth/google/callback?state=${oidcState}&code=test-code` };
}
async function authorize() {
  const attempt = await begin();
  const response = await app.inject({
    method: "GET",
    url: attempt.callback,
    headers: { cookie: attempt.cookie },
  });
  expect(response.statusCode).toBe(302);
  return { attempt, response, code: new URL(response.headers.location!).searchParams.get("code")! };
}
const exchange = (code: string, values: object = {}, headers: Record<string, string> = {}) =>
  app.inject({
    method: "POST",
    url: "/auth/desktop/exchange",
    headers,
    payload: { code, codeVerifier: verifier, redirectUri, ...values },
  });

describe("login nativo com navegador e PKCE", () => {
  it("retorna apenas código temporário e cria sessão somente na troca autenticada pelo verifier", async () => {
    const [before] = await database.database.db.select({ total: count() }).from(accountSessions);
    const { response, code } = await authorize();
    const returned = new URL(response.headers.location!);
    expect(returned.origin + returned.pathname).toBe(redirectUri);
    expect(returned.searchParams.get("state")).toBe(state);
    expect(response.body + response.headers.location).not.toMatch(/nsa_|nsr_/);
    const [after] = await database.database.db.select({ total: count() }).from(accountSessions);
    expect(after!.total).toBe(before!.total);
    const [grant] = await database.database.db
      .select()
      .from(desktopLoginGrants)
      .where(eq(desktopLoginGrants.codeHash, hash(code)));
    expect(grant!.expiresAt.getTime() - Date.now()).toBeGreaterThan(0);
    expect(grant!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60_000);
    expect(JSON.stringify(grant)).not.toContain(code);
    const result = await exchange(code);
    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["set-cookie"]).toBeUndefined();
    const credentials = result.json<{ accessToken: string; refreshToken: string }>();
    expect(await sessions.authenticate(credentials.accessToken)).toMatchObject({
      role: "owner",
      organizationId: grant!.organizationId,
    });
    expect((await exchange(code)).statusCode).toBe(403);
  });
  it("recusa navegador sem o vínculo e mantém o retorno legítimo", async () => {
    const attempt = await begin();
    expect((await app.inject({ method: "GET", url: attempt.callback })).statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: attempt.callback,
          headers: { cookie: attempt.cookie },
        })
      ).statusCode,
    ).toBe(302);
  });
  it("vincula o código ao verifier e retorno exatos sem consumir tentativas erradas", async () => {
    const { code } = await authorize();
    expect((await exchange(code, { codeVerifier: "x".repeat(43) })).statusCode).toBe(403);
    expect(
      (await exchange(code, { redirectUri: "http://127.0.0.1:45679/neurons/callback" })).statusCode,
    ).toBe(403);
    expect((await exchange(code)).statusCode).toBe(200);
  });
  it("recusa retornos fora do loopback literal e caminhos arbitrários", async () => {
    for (const returnUri of [
      "https://other.invalid/return",
      "http://localhost:1234/neurons/callback",
      "http://127.0.0.1:65536/neurons/callback",
      "http://127.0.0.1:1234/other",
      "http://127.0.0.1:1234/neurons/callback?target=other",
    ]) {
      expect(
        (await app.inject({ method: "GET", url: `/auth/desktop?${beginQuery(returnUri)}` }))
          .statusCode,
      ).toBe(400);
    }
  });
  it("recusa o código expirado e a tentativa nativa expirada sem criar sessão web", async () => {
    const { code } = await authorize();
    await database.database.db
      .update(desktopLoginGrants)
      .set({ expiresAt: new Date(0) })
      .where(eq(desktopLoginGrants.codeHash, hash(code)));
    expect((await exchange(code)).statusCode).toBe(403);
    const attempt = await begin();
    await database.database.db
      .update(desktopLoginAttempts)
      .set({ expiresAt: new Date(0) })
      .where(eq(desktopLoginAttempts.stateHash, hash(attempt.oidcState)));
    const result = await app.inject({
      method: "GET",
      url: attempt.callback,
      headers: { cookie: attempt.cookie },
    });
    expect(result.statusCode).toBe(403);
    expect(String(result.headers["set-cookie"])).not.toMatch(/nsa_|nsr_/);
  });
  it("cancela pelo navegador com vínculo e sem emitir credenciais", async () => {
    const attempt = await begin();
    const response = await app.inject({
      method: "GET",
      url: `/auth/google/callback?state=${attempt.oidcState}&error=access_denied`,
      headers: { cookie: attempt.cookie },
    });
    expect(response.statusCode).toBe(302);
    const returned = new URL(response.headers.location!);
    expect(returned.searchParams.get("error")).toBe("access_denied");
    expect(returned.searchParams.get("state")).toBe(state);
    expect(returned.searchParams.has("code")).toBe(false);
    expect(
      (
        await app.inject({
          method: "GET",
          url: attempt.callback,
          headers: { cookie: attempt.cookie },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("permite uma única troca concorrente e impede a troca em JavaScript de navegador", async () => {
    const { code } = await authorize();
    expect((await exchange(code, {}, { origin })).statusCode).toBe(403);
    const results = await Promise.all([exchange(code), exchange(code)]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 403]);
  });
  it("não emite sessão se o vínculo foi removido antes da troca", async () => {
    const { code } = await authorize();
    const { memberships } = await import("../database/schema/accounts.js");
    const [grant] = await database.database.db
      .select()
      .from(desktopLoginGrants)
      .where(eq(desktopLoginGrants.codeHash, hash(code)));
    await database.database.db
      .delete(memberships)
      .where(eq(memberships.organizationId, grant!.organizationId));
    expect((await exchange(code)).statusCode).toBe(403);
  });
});
