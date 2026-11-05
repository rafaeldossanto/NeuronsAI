import { createHmac, timingSafeEqual } from "node:crypto";

/** Requests whose timestamp is further than this from the server's clock are refused (both ways). */
export const SIGNATURE_WINDOW_SEC = 300;

export const TIMESTAMP_HEADER = "x-neurons-timestamp";
export const SIGNATURE_HEADER = "x-neurons-signature";

const SIGNATURE_PREFIX = "sha256=";
const TIMESTAMP_PATTERN = /^\d{1,12}$/;
const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * HMAC-SHA256, in hex, of `timestamp + "." + body` (the body exactly as received) under the
 * trigger's secret. The caller sends it as `X-Neurons-Signature: sha256=<hex>`.
 */
export function computeSignature(secret: string, timestamp: string, body: Buffer): string {
  return createHmac("sha256", secret).update(timestamp).update(".").update(body).digest("hex");
}

export type SignatureCheck =
  | { ok: true; signature: string }
  | { ok: false; reason: "missing_header" | "malformed_header" | "outside_window" | "mismatch" };

export interface SignatureInput {
  secret: string;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
  body: Buffer;
  now: Date;
}

/**
 * Checks the headers' format and the time window first (cheap), then the HMAC in constant time.
 * On success `signature` is the lowercase hex, the key for refusing a replay.
 */
export function verifySignature(input: SignatureInput): SignatureCheck {
  const { timestampHeader, signatureHeader } = input;
  if (timestampHeader === undefined || signatureHeader === undefined) {
    return { ok: false, reason: "missing_header" };
  }
  if (!TIMESTAMP_PATTERN.test(timestampHeader) || !signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return { ok: false, reason: "malformed_header" };
  }
  const received = signatureHeader.slice(SIGNATURE_PREFIX.length);
  if (!HEX_SHA256_PATTERN.test(received)) return { ok: false, reason: "malformed_header" };

  const skewSec = Math.abs(input.now.getTime() / 1000 - Number(timestampHeader));
  if (skewSec > SIGNATURE_WINDOW_SEC) return { ok: false, reason: "outside_window" };

  const expected = Buffer.from(computeSignature(input.secret, timestampHeader, input.body), "hex");
  if (!timingSafeEqual(expected, Buffer.from(received, "hex"))) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, signature: received.toLowerCase() };
}
