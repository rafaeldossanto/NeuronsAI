import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AesGcmSecretCipher, UnavailableSecretCipher } from "./secret-cipher.js";
import { MasterKeyNotConfiguredError } from "./secrets.errors.js";

const newCipher = () => new AesGcmSecretCipher(randomBytes(32));

describe("AesGcmSecretCipher", () => {
  it("round-trips a value, including non-ASCII text", () => {
    const cipher = newCipher();
    const encrypted = cipher.encrypt("sk-ação-€-🔑", "anthropic");

    expect(cipher.decrypt(encrypted, "anthropic")).toBe("sk-ação-€-🔑");
  });

  it("does not store the plaintext and uses a fresh IV every time", () => {
    const cipher = newCipher();
    const first = cipher.encrypt("segredo", "k");
    const second = cipher.encrypt("segredo", "k");

    expect(first.ciphertext.toString("utf8")).not.toContain("segredo");
    expect(first.iv.equals(second.iv)).toBe(false);
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
  });

  it("fails to decrypt with a different key", () => {
    const encrypted = newCipher().encrypt("segredo", "k");

    expect(() => newCipher().decrypt(encrypted, "k")).toThrow();
  });

  it("fails when the auth tag is tampered with", () => {
    const cipher = newCipher();
    const encrypted = cipher.encrypt("segredo", "k");
    const authTag = Buffer.from(encrypted.authTag);
    authTag[0] = (authTag[0] ?? 0) ^ 0xff;

    expect(() => cipher.decrypt({ ...encrypted, authTag }, "k")).toThrow();
  });

  it("fails when the ciphertext is tampered with", () => {
    const cipher = newCipher();
    const encrypted = cipher.encrypt("segredo", "k");
    const ciphertext = Buffer.from(encrypted.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;

    expect(() => cipher.decrypt({ ...encrypted, ciphertext }, "k")).toThrow();
  });

  it("fails when decrypted under another context (value moved to another name)", () => {
    const cipher = newCipher();
    const encrypted = cipher.encrypt("segredo", "openai");

    expect(() => cipher.decrypt(encrypted, "anthropic")).toThrow();
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => new AesGcmSecretCipher(randomBytes(16))).toThrow(RangeError);
  });
});

describe("UnavailableSecretCipher", () => {
  it("explains that the master key is missing", () => {
    const cipher = new UnavailableSecretCipher();

    expect(() => cipher.encrypt()).toThrow(MasterKeyNotConfiguredError);
    expect(() => cipher.decrypt()).toThrow(MasterKeyNotConfiguredError);
  });
});
