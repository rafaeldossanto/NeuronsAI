import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { graphTriggers } from "../database/schema/index.js";
import { DrizzleGraphRepository } from "../graphs/drizzle-graph.repository.js";
import { DrizzleSecretRepository } from "../secrets/drizzle-secret.repository.js";
import { AesGcmSecretCipher } from "../secrets/secret-cipher.js";
import { SecretsService } from "../secrets/secrets.service.js";
import { OrphanWebhookSecrets } from "./orphan-webhook-secrets.js";
import { webhookSecretName } from "./webhook-secret-name.js";

let testDb: TestDatabase;
let graphs: DrizzleGraphRepository;
let secrets: SecretsService;

beforeAll(async () => {
  testDb = await startTestDatabase();
  graphs = new DrizzleGraphRepository(testDb.database);
  secrets = new SecretsService(
    new DrizzleSecretRepository(testDb.database),
    new AesGcmSecretCipher(randomBytes(32)),
  );
});

afterAll(async () => {
  await testDb.stop();
});

const hookId = () => randomBytes(16).toString("base64url");

async function graphWithWebhook() {
  const graph = await graphs.create({ name: "Com webhook" });
  const hook = hookId();
  await testDb.database.db
    .insert(graphTriggers)
    .values({ graphId: graph.id, triggerId: "t", hookId: hook });
  await secrets.set(webhookSecretName(hook), "whsec_x");
  return { graph, name: webhookSecretName(hook) };
}

describe("webhook secrets and graph deletion", () => {
  it("deletes the webhook secret together with the graph", async () => {
    const { graph, name } = await graphWithWebhook();
    await secrets.set("anthropic.key", "outro");

    expect(await graphs.delete(graph.id)).toBe(true);

    expect(await secrets.listNames()).not.toContain(name);
    expect(await secrets.listNames()).toContain("anthropic.key");
  });

  it("leaves everything alone when the graph does not exist", async () => {
    const { graph, name } = await graphWithWebhook();

    expect(await graphs.delete("00000000-0000-4000-8000-000000000000")).toBe(false);

    expect(await secrets.listNames()).toContain(name);
    expect(await graphs.findById(graph.id)).toBeDefined();
  });
});

describe("OrphanWebhookSecrets", () => {
  it("removes only orphans of the generated shape, and is idempotent", async () => {
    const { name: kept } = await graphWithWebhook();
    const orphan = webhookSecretName(hookId());
    await secrets.set(orphan, "whsec_orphan");
    await secrets.set("webhook.feito-a-mao", "do usuário");

    const cleaner = new OrphanWebhookSecrets(testDb.database);
    expect(await cleaner.purge()).toBe(1);
    expect(await cleaner.purge()).toBe(0);

    const names = await secrets.listNames();
    expect(names).not.toContain(orphan);
    expect(names).toContain(kept);
    expect(names).toContain("webhook.feito-a-mao");
  });
});
