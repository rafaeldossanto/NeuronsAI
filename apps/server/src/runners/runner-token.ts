import { createHash, randomBytes } from "node:crypto";

/** Marks a string as a runner token (so a leaked one is recognizable by scanners and by people). */
export const RUNNER_TOKEN_PREFIX = "nrn_";

/** A new random token: 256 bits, shown once to whoever issues it. */
export const generateRunnerToken = (): string =>
  `${RUNNER_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;

/** What the database keeps. The token is long and random, so a plain SHA-256 is enough. */
export const hashRunnerToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** The token of an `Authorization: Bearer <token>` header, if that is what the header holds. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match?.[1];
}
