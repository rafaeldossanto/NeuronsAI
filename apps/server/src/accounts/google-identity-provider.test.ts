import { createHash } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { GoogleIdentityProvider } from "./google-identity-provider.js";
import { IdentityVerificationError } from "./login.errors.js";

const config = {
  clientId: "test-client",
  clientSecret: "placeholder",
  redirectUri: "https://neurons.example.invalid/auth/google/callback",
};
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let resolver: ReturnType<typeof createLocalJWKSet>;
const now = new Date("2026-11-05T12:00:00Z");
const input = {
  code: "authorization-code",
  codeVerifier: createHash("sha256").update("test").digest("base64url"),
  nonce: "expected-nonce",
  redirectUri: config.redirectUri,
};
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  resolver = createLocalJWKSet({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: "test", use: "sig", alg: "RS256" }],
  });
});
async function token(changes: JWTPayload = {}, omit: string[] = []) {
  const payload: JWTPayload = {
    iss: "https://accounts.google.com",
    sub: "subject-1",
    aud: config.clientId,
    iat: now.getTime() / 1000,
    exp: now.getTime() / 1000 + 3600,
    nonce: input.nonce,
    name: "Pessoa",
    email: "pessoa@example.invalid",
    email_verified: true,
    ...changes,
  };
  for (const name of omit) delete payload[name];
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(keys.privateKey);
}
async function provider(changes: JWTPayload = {}, omit: string[] = []) {
  const signed = await token(changes, omit);
  const transport = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ id_token: signed })));
  return {
    provider: new GoogleIdentityProvider(config, transport, resolver, () => now),
    transport,
  };
}

describe("Google OIDC (sem chamadas reais)", () => {
  it("usa code + PKCE S256, nonce, state e apenas os escopos de identidade", async () => {
    const { provider: google } = await provider();
    const url = google.authorizationUrl({
      state: "state",
      nonce: "nonce",
      codeChallenge: "challenge",
      redirectUri: config.redirectUri,
    });
    expect(url.origin).toBe("https://accounts.google.com");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      code_challenge_method: "S256",
      scope: "openid profile email",
      state: "state",
      nonce: "nonce",
    });
    expect(url.href).not.toContain(config.clientSecret);
    expect(() =>
      google.authorizationUrl({
        state: "s",
        nonce: "n",
        codeChallenge: "c",
        redirectUri: "https://other.invalid",
      }),
    ).toThrow(IdentityVerificationError);
  });

  it("troca o code por POST e verifica assinatura, claims e email verificado", async () => {
    const { provider: google, transport } = await provider();
    expect(await google.exchange(input)).toEqual({
      issuer: "https://accounts.google.com",
      subject: "subject-1",
      displayName: "Pessoa",
      email: "pessoa@example.invalid",
    });
    const [url, options] = transport.mock.calls[0]!;
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(options).toMatchObject({ method: "POST", redirect: "error" });
    expect(Object.fromEntries(options!.body as URLSearchParams)).toMatchObject({
      code_verifier: input.codeVerifier,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    });
  });

  it.each([
    ["issuer", { iss: "https://evil.invalid" }],
    ["audience", { aud: "someone-else" }],
    ["nonce", { nonce: "other" }],
    ["expiry", { exp: 1 }],
    ["azp", { azp: "other-client" }],
    ["multi-audience", { aud: [config.clientId, "another-client"] }],
    ["future iat", { iat: now.getTime() / 1000 + 600 }],
  ])("recusa %s inválido", async (_label, claims) => {
    const { provider: google } = await provider(claims);
    await expect(google.exchange(input)).rejects.toThrow(IdentityVerificationError);
  });

  it.each(["exp", "iat", "sub", "nonce"])("exige o claim %s", async (claim) => {
    const { provider: google } = await provider({}, [claim]);
    await expect(google.exchange(input)).rejects.toThrow(IdentityVerificationError);
  });

  it("recusa token assinado por outra chave e não usa a chave do header", async () => {
    const { provider: google } = await provider();
    const other = await generateKeyPair("RS256");
    const bad = await new SignJWT({ sub: "attacker" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .sign(other.privateKey);
    const transport: typeof fetch = () => Promise.resolve(Response.json({ id_token: bad }));
    await expect(
      new GoogleIdentityProvider(config, transport, resolver, () => now).exchange(input),
    ).rejects.toThrow(IdentityVerificationError);
    await expect(
      google.exchange({ ...input, redirectUri: "https://evil.invalid" }),
    ).rejects.toThrow(IdentityVerificationError);
  });

  it("normaliza os dois issuers do Google e não aceita email não verificado", async () => {
    const { provider: google } = await provider({
      iss: "accounts.google.com",
      email_verified: false,
    });
    expect(await google.exchange(input)).toEqual({
      issuer: "https://accounts.google.com",
      subject: "subject-1",
      displayName: "Pessoa",
    });
  });

  it("não propaga resposta, token ou segredo do provedor nos erros", async () => {
    const transport: typeof fetch = () =>
      Promise.resolve(new Response("conteúdo confidencial", { status: 400 }));
    try {
      await new GoogleIdentityProvider(config, transport, resolver).exchange(input);
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityVerificationError);
      expect((error as Error).cause).toBeUndefined();
      expect(JSON.stringify(error)).not.toContain("confidencial");
    }
    const oversized: typeof fetch = () => Promise.resolve(new Response("x".repeat(70_000)));
    await expect(
      new GoogleIdentityProvider(config, oversized, resolver).exchange(input),
    ).rejects.toThrow(IdentityVerificationError);
  });
});
