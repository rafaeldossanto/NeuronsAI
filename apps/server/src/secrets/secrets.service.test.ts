import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { AesGcmSecretCipher, UnavailableSecretCipher } from "./secret-cipher.js";
import {
  InvalidSecretNameError,
  MasterKeyNotConfiguredError,
  SecretDecryptionError,
  SecretNotFoundError,
} from "./secrets.errors.js";
import { SecretsService } from "./secrets.service.js";
import { InMemorySecretRepository } from "./testing/in-memory-secret-repository.js";

describe("SecretsService", () => {
  let repository: InMemorySecretRepository;
  let service: SecretsService;

  beforeEach(() => {
    repository = new InMemorySecretRepository();
    service = new SecretsService(repository, new AesGcmSecretCipher(randomBytes(32)));
  });

  it("returns what was stored", async () => {
    await service.set("anthropic.api-key", "sk-123");

    expect(await service.get("anthropic.api-key")).toBe("sk-123");
  });

  it("replaces the value when the name is set again", async () => {
    await service.set("token", "old");
    await service.set("token", "new");

    expect(await service.get("token")).toBe("new");
    expect(await service.listNames()).toEqual(["token"]);
  });

  it("persists only encrypted data", async () => {
    await service.set("token", "plain-value");

    const stored = repository.stored.get("token");
    expect(stored?.ciphertext.toString("utf8")).not.toContain("plain-value");
  });

  it("lists names (sorted) and never values", async () => {
    await service.set("b", "second-value");
    await service.set("a", "first-value");

    const names = await service.listNames();

    expect(names).toEqual(["a", "b"]);
    expect(JSON.stringify(names)).not.toContain("value");
  });

  it("throws SecretNotFoundError for an unknown name", async () => {
    await expect(service.get("missing")).rejects.toBeInstanceOf(SecretNotFoundError);
  });

  it("fails with SecretDecryptionError, without leaking data, when the master key changed", async () => {
    await service.set("token", "plain-value");
    const otherKey = new SecretsService(repository, new AesGcmSecretCipher(randomBytes(32)));

    const failure = await otherKey.get("token").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SecretDecryptionError);
    expect((failure as Error).message).not.toContain("plain-value");
  });

  it("fails when a stored value is moved to another name", async () => {
    await service.set("openai", "plain-value");
    repository.stored.set("anthropic", repository.stored.get("openai")!);

    await expect(service.get("anthropic")).rejects.toBeInstanceOf(SecretDecryptionError);
  });

  it.each(["", "with space", "a/b", "x".repeat(129)])(
    "rejects the invalid name %j",
    async (name) => {
      await expect(service.set(name, "v")).rejects.toBeInstanceOf(InvalidSecretNameError);
      await expect(service.get(name)).rejects.toBeInstanceOf(InvalidSecretNameError);
    },
  );

  it("reports a missing master key instead of a decryption failure", async () => {
    const withoutKey = new SecretsService(repository, new UnavailableSecretCipher());
    await service.set("token", "v");

    await expect(withoutKey.set("other", "v")).rejects.toBeInstanceOf(MasterKeyNotConfiguredError);
    await expect(withoutKey.get("token")).rejects.toBeInstanceOf(MasterKeyNotConfiguredError);
  });
});
