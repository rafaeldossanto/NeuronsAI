import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SIGNATURE_WINDOW_SEC,
  computeSignature,
  verifySignature,
  type SignatureInput,
} from "./webhook-signature.js";

const secret = randomBytes(32).toString("base64url");
const body = Buffer.from('{"mensagem":"oi"}');
const now = new Date("2026-11-04T15:00:00.000Z");
const nowSec = now.getTime() / 1000;

function signed(overrides: Partial<SignatureInput> = {}, timestampSec = nowSec): SignatureInput {
  const timestamp = String(timestampSec);
  return {
    secret,
    timestampHeader: timestamp,
    signatureHeader: `sha256=${computeSignature(secret, timestamp, body)}`,
    body,
    now,
    ...overrides,
  };
}

describe("computeSignature", () => {
  it("signs `timestamp.body` with HMAC-SHA256 in hex (known answer, same as the curl example)", () => {
    // A public test vector, not a secret. Produced by an independent tool:
    //   printf '%s.%s' 1730732400 corpo | openssl dgst -sha256 -hmac vetor-de-teste -hex
    const signature = computeSignature("vetor-de-teste", "1730732400", Buffer.from("corpo"));
    expect(signature).toBe("7417a99703e99c17ca904331ccabe10e1564cebfc5ae3418e3b2806a526ac9e9");
  });

  it("depends on the timestamp and on the secret", () => {
    const base = computeSignature(secret, "1730732400", body);
    expect(base).not.toBe(computeSignature(secret, "1730732401", body));
    expect(base).not.toBe(
      computeSignature(randomBytes(32).toString("base64url"), "1730732400", body),
    );
  });

  it("covers the raw bytes of the body, not a parsed version of it", () => {
    const compact = computeSignature(secret, "1", Buffer.from('{"a":1}'));
    const spaced = computeSignature(secret, "1", Buffer.from('{"a": 1}'));
    expect(compact).not.toBe(spaced);
  });
});

describe("verifySignature", () => {
  it("accepts a correct signature and returns it in lowercase hex", () => {
    const input = signed();
    const result = verifySignature(input);
    expect(result).toEqual({
      ok: true,
      signature: input.signatureHeader?.slice("sha256=".length),
    });
  });

  it("accepts uppercase hex and reports it normalized", () => {
    const input = signed();
    const upper = `sha256=${input.signatureHeader!.slice(7).toUpperCase()}`;
    const result = verifySignature({ ...input, signatureHeader: upper });
    expect(result).toMatchObject({ ok: true, signature: input.signatureHeader!.slice(7) });
  });

  it("refuses a signature made with another secret", () => {
    const other = randomBytes(32).toString("base64url");
    const timestamp = String(nowSec);
    const result = verifySignature(
      signed({ signatureHeader: `sha256=${computeSignature(other, timestamp, body)}` }),
    );
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("refuses a body that changed after signing", () => {
    expect(verifySignature(signed({ body: Buffer.from('{"mensagem":"tchau"}') }))).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("refuses a timestamp that was swapped after signing", () => {
    const input = signed();
    expect(verifySignature({ ...input, timestampHeader: String(nowSec + 1) })).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  describe("time window of 5 minutes", () => {
    it("accepts the edges of the window and refuses one second beyond, in both directions", () => {
      expect(SIGNATURE_WINDOW_SEC).toBe(300);
      expect(verifySignature(signed({}, nowSec - 300)).ok).toBe(true);
      expect(verifySignature(signed({}, nowSec + 300)).ok).toBe(true);
      expect(verifySignature(signed({}, nowSec - 301))).toEqual({
        ok: false,
        reason: "outside_window",
      });
      expect(verifySignature(signed({}, nowSec + 301))).toEqual({
        ok: false,
        reason: "outside_window",
      });
    });

    it("refuses an old but otherwise valid signature", () => {
      const result = verifySignature(signed({}, nowSec - 3_600));
      expect(result).toEqual({ ok: false, reason: "outside_window" });
    });
  });

  describe("malformed or missing headers", () => {
    it.each([
      ["no timestamp", { timestampHeader: undefined }, "missing_header"],
      ["no signature", { signatureHeader: undefined }, "missing_header"],
      ["a timestamp that is not a number", { timestampHeader: "ontem" }, "malformed_header"],
      ["a negative timestamp", { timestampHeader: "-5" }, "malformed_header"],
      ["a timestamp in milliseconds with a dot", { timestampHeader: "1.5e9" }, "malformed_header"],
      ["a signature without the sha256= prefix", { signatureHeader: "abc" }, "malformed_header"],
      [
        "a signature that is not hex",
        { signatureHeader: `sha256=${"z".repeat(64)}` },
        "malformed_header",
      ],
      ["a signature of the wrong length", { signatureHeader: "sha256=abcd" }, "malformed_header"],
      ["another algorithm", { signatureHeader: `sha1=${"a".repeat(64)}` }, "malformed_header"],
    ] as const)("refuses %s", (_name, overrides, reason) => {
      expect(verifySignature(signed(overrides))).toEqual({ ok: false, reason });
    });
  });
});
