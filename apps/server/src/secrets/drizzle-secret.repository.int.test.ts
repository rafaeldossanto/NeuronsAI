import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { DrizzleSecretRepository } from "./drizzle-secret.repository.js";
import { AesGcmSecretCipher } from "./secret-cipher.js";
import { SecretsService } from "./secrets.service.js";

let testDb: TestDatabase;
let service: SecretsService;

beforeAll(async () => {
  testDb = await startTestDatabase();
  service = new SecretsService(
    new DrizzleSecretRepository(testDb.database),
    new AesGcmSecretCipher(randomBytes(32)),
  );
});

afterAll(async () => {
  await testDb.stop();
});

describe("SecretsService", () => {
  it("round-trips a value through the bytea columns", async () => {
    await service.set("anthropic", "sk-ação-123");

    expect(await service.get("anthropic")).toBe("sk-ação-123");
  });

  it("replaces the value on a second set and lists names in order", async () => {
    await service.set("zeta", "1");
    await service.set("alpha", "1");
    await service.set("alpha", "2");

    expect(await service.get("alpha")).toBe("2");
    expect(await service.listNames()).toEqual(["alpha", "anthropic", "zeta"]);
  });
});
