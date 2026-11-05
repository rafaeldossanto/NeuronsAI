import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { ReadableStreamReadResult } from "node:stream/web";
import { z } from "zod";
import type { IdentityProvider, VerifiedIdentity } from "./identity-provider.js";
import { IdentityVerificationError } from "./login.errors.js";

export interface GoogleIdentityConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const ISSUER = "https://accounts.google.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const claimsSchema = z.object({
  sub: z.string().min(1).max(255),
  nonce: z.string().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  email: z.email().max(320).optional(),
  email_verified: z.boolean().optional(),
  azp: z.string().optional(),
});

/** Fixed Google endpoints and pinned RS256. Test hooks replace transport/keys, never token checks. */
export class GoogleIdentityProvider implements IdentityProvider {
  private readonly keys: JWTVerifyGetKey;
  constructor(
    private readonly config: GoogleIdentityConfig,
    private readonly transport: typeof fetch = fetch,
    keys?: JWTVerifyGetKey,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.keys = keys ?? createRemoteJWKSet(new URL(JWKS_URL), { timeoutDuration: 10_000 });
  }

  authorizationUrl(input: Parameters<IdentityProvider["authorizationUrl"]>[0]): URL {
    if (input.redirectUri !== this.config.redirectUri) throw new IdentityVerificationError();
    const url = new URL(AUTHORIZATION_URL);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: "openid profile email",
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return url;
  }

  async exchange(input: Parameters<IdentityProvider["exchange"]>[0]): Promise<VerifiedIdentity> {
    try {
      if (input.redirectUri !== this.config.redirectUri || !input.code || input.code.length > 4096)
        throw new IdentityVerificationError();
      const response = await this.transport(TOKEN_URL, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: input.code,
          code_verifier: input.codeVerifier,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          redirect_uri: this.config.redirectUri,
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new IdentityVerificationError();
      }
      const raw = await readBounded(response);
      const { id_token: idToken } = z
        .object({ id_token: z.string().max(16_384) })
        .parse(JSON.parse(raw));
      const { payload } = await jwtVerify(idToken, this.keys, {
        issuer: [ISSUER, "accounts.google.com"],
        audience: this.config.clientId,
        algorithms: ["RS256"],
        requiredClaims: ["iss", "aud", "exp", "iat", "sub", "nonce"],
        maxTokenAge: "10 minutes",
        clockTolerance: 5,
        currentDate: this.now(),
      });
      const claims = claimsSchema.parse(payload);
      if (
        claims.nonce !== input.nonce ||
        (claims.azp && claims.azp !== this.config.clientId) ||
        (Array.isArray(payload.aud) &&
          payload.aud.length > 1 &&
          claims.azp !== this.config.clientId)
      )
        throw new IdentityVerificationError();
      return {
        issuer: ISSUER,
        subject: claims.sub,
        displayName: claims.name ?? "Usuário Google",
        ...(claims.email_verified === true && claims.email ? { email: claims.email } : {}),
      };
    } catch {
      // Provider error bodies can echo codes, client secrets or tokens. Never attach the cause.
      throw new IdentityVerificationError();
    }
  }
}

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new IdentityVerificationError();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = (await reader.read()) as ReadableStreamReadResult<Uint8Array>;
      if (done) break;
      length += value.byteLength;
      if (length > 65_536) throw new IdentityVerificationError();
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel();
  }
}
