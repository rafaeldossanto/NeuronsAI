import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import twoAgents from "@neurons/graph-schema/examples/two-agents.json" with { type: "json" };
import { eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { graphTriggers, graphs, runs, secrets } from "../database/schema/index.js";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { DrizzleGraphRepository } from "../graphs/drizzle-graph.repository.js";
import { DrizzleGraphVersionRepository } from "../graphs/drizzle-graph-version.repository.js";
import { GraphVersionService } from "../graphs/graph-version.service.js";
import { DrizzleSecretRepository } from "../secrets/drizzle-secret.repository.js";
import { AesGcmSecretCipher } from "../secrets/secret-cipher.js";
import { SecretsService } from "../secrets/secrets.service.js";
import { testConfig } from "../shared/config/testing/test-config.js";
import { OrganizationAccessError } from "./account.errors.js";
import { AccountsService, type AccountUser } from "./accounts.service.js";
import {
  LocalDataAdoption,
  LocalRunsActiveError,
  LocalSecretsConflictError,
} from "./local-data-adoption.service.js";
import { resourceScope } from "./resource-scope.js";
import { SignupPolicy } from "./signup-policy.js";

/** A database that has an old local workspace, then gets accounts: the adoption is explicit. */

let testDb: TestDatabase;
let accounts: AccountsService;
let dataDir: string;
let masterKey: Buffer;
let adoption: LocalDataAdoption;
let alice: AccountUser;
let bob: AccountUser;
let aliceOrg: string;
let dumpOrg: string;
let sequence = 0;
const db = () => testDb.database.db;
const MEMORY_ID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";

beforeAll(async () => {
  testDb = await startTestDatabase();
  accounts = new AccountsService(testDb.database, SignupPolicy.open());
  const keeper = await accounts.provisionIdentity({
    issuer: "https://identity.example.invalid",
    subject: "adopt-dump",
    displayName: "Descarte",
  });
  dumpOrg = (await accounts.listOrganizations(keeper.id))[0]!.id;
});

afterAll(async () => {
  await testDb.stop();
});

beforeEach(async () => {
  // Every case starts with the old, account-free data and two people with an organization each.
  await db().delete(graphTriggers);
  await db().delete(secrets);
  // Whatever an earlier case left local (a refusal moves nothing) goes to a throwaway organization.
  if (sequence > 0) {
    const [leftover] = await db()
      .select({ id: graphs.id })
      .from(graphs)
      .where(isNull(graphs.organizationId));
    if (leftover) {
      await db().update(runs).set({ status: "succeeded" });
      await db()
        .update(graphs)
        .set({ organizationId: dumpOrg })
        .where(isNull(graphs.organizationId));
    }
  }
  dataDir = await mkdtemp(path.join(os.tmpdir(), "neurons-adopt-"));
  masterKey = randomBytes(32);

  const identity = () => ({
    issuer: "https://identity.example.invalid",
    subject: `adopt-${++sequence}`,
    displayName: "Pessoa de teste",
  });
  alice = await accounts.provisionIdentity(identity());
  bob = await accounts.provisionIdentity(identity());
  aliceOrg = (await accounts.listOrganizations(alice.id))[0]!.id;
  adoption = new LocalDataAdoption(
    testDb.database,
    testConfig({ dataDir, masterKey, localDataOrganizationId: aliceOrg }),
  );
});

afterAll(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

/** The old local workspace: a graph with a version, a run, a schedule, a secret and a memory. */
async function seedLocalWorkspace() {
  const graphRepository = new DrizzleGraphRepository(testDb.database);
  const versions = new GraphVersionService(
    graphRepository,
    new DrizzleGraphVersionRepository(testDb.database),
  );
  const graph = await graphRepository.create({ name: "Grafo antigo" });
  const published = await versions.publish(graph.id, { ...twoAgents, id: graph.id });
  if (!published.ok) throw new Error("grafo de exemplo inválido");
  const [run] = await db()
    .insert(runs)
    .values({ graphVersionId: published.version.id, status: "succeeded" })
    .returning();
  await db()
    .insert(graphTriggers)
    .values({
      graphId: graph.id,
      triggerId: "agenda",
      hookId: randomBytes(16).toString("base64url"),
      enabled: true,
      nextRunAt: new Date(Date.now() + 60_000),
    });
  const localSecrets = new SecretsService(
    new DrizzleSecretRepository(testDb.database),
    new AesGcmSecretCipher(masterKey),
  );
  await localSecrets.set("anthropic", "valor-secreto-local");
  await mkdir(path.join(dataDir, "memories", MEMORY_ID), { recursive: true });
  await writeFile(path.join(dataDir, "memories", MEMORY_ID, "memory.json"), "{}");
  return { graph, run: run!, localSecrets };
}

describe("LocalDataAdoption", () => {
  it("moves the whole local workspace into the organization, in one go", async () => {
    const { graph, run } = await seedLocalWorkspace();

    const summary = await adoption.summary(alice.id, aliceOrg);
    expect(summary).toEqual({
      graphs: 1,
      versions: 1,
      runs: 1,
      secrets: 1,
      triggers: 1,
      memories: 1,
    });
    const moved = await adoption.adopt(alice.id, aliceOrg);
    expect(moved).toEqual(summary);

    const [movedGraph] = await db().select().from(graphs).where(eq(graphs.id, graph.id));
    expect(movedGraph?.organizationId).toBe(aliceOrg);
    expect(await db().select().from(graphs).where(isNull(graphs.organizationId))).toEqual([]);
    expect((await db().select().from(runs).where(eq(runs.id, run.id))).length).toBe(1);

    // The secret still opens, now under the organization's scope (re-encrypted, not copied).
    const orgSecrets = new SecretsService(
      new DrizzleSecretRepository(testDb.database),
      new AesGcmSecretCipher(masterKey),
    );
    await resourceScope.run({ organizationId: aliceOrg }, async () => {
      expect(await orgSecrets.get("anthropic")).toBe("valor-secreto-local");
    });
    expect(await orgSecrets.listNames()).toEqual([]);

    // The schedule that was armed under the local scope is off until the owner turns it on.
    const [trigger] = await db().select().from(graphTriggers);
    expect(trigger).toMatchObject({ enabled: false, nextRunAt: null });

    const memoriesRoot = path.join(dataDir, "memories");
    expect(await readdir(path.join(memoriesRoot, "organizations", aliceOrg))).toEqual([MEMORY_ID]);
    expect(await readdir(memoriesRoot)).toEqual(["organizations"]);
  });

  it("brings every trigger over switched off, a webhook that was on included", async () => {
    const { graph } = await seedLocalWorkspace();
    await db()
      .insert(graphTriggers)
      .values({
        graphId: graph.id,
        triggerId: "webhook",
        hookId: randomBytes(16).toString("base64url"),
        enabled: true,
        secretSetAt: new Date(),
      });

    await adoption.adopt(alice.id, aliceOrg);

    const triggers = await db().select().from(graphTriggers);
    expect(triggers).toHaveLength(2);
    expect(triggers.every((trigger) => !trigger.enabled && trigger.nextRunAt === null)).toBe(true);
  });

  it("gives the local workspace to only one of two organizations that claim it at once", async () => {
    const { graph } = await seedLocalWorkspace();
    const bobOrg = (await accounts.listOrganizations(bob.id))[0]!.id;

    await Promise.allSettled([adoption.adopt(alice.id, aliceOrg), adoption.adopt(bob.id, bobOrg)]);

    // Graph and secret end up together in one organization: none is left behind, none is taken.
    const [movedGraph] = await db().select().from(graphs).where(eq(graphs.id, graph.id));
    const [movedSecret] = await db().select().from(secrets);
    expect(movedGraph?.organizationId).toBe(aliceOrg);
    await expect(adoption.summary(bob.id, bobOrg)).rejects.toBeInstanceOf(OrganizationAccessError);
    expect(movedSecret?.organizationId).toBe(movedGraph?.organizationId);
  });

  it("is idempotent: a second call finds nothing and changes nothing", async () => {
    await seedLocalWorkspace();
    await adoption.adopt(alice.id, aliceOrg);

    const again = await adoption.adopt(alice.id, aliceOrg);

    expect(again).toEqual({
      graphs: 0,
      versions: 0,
      runs: 0,
      secrets: 0,
      triggers: 0,
      memories: 0,
    });
    expect(
      (await db().select().from(graphs)).filter((g) => g.organizationId === aliceOrg),
    ).toHaveLength(1);
    expect(await db().select().from(secrets)).toHaveLength(1);
  });

  it("finishes the memories a crash left behind, without touching the rest", async () => {
    await adoption.adopt(alice.id, aliceOrg);
    await mkdir(path.join(dataDir, "memories", MEMORY_ID), { recursive: true });

    expect((await adoption.adopt(alice.id, aliceOrg)).memories).toBe(1);
    expect(await readdir(path.join(dataDir, "memories", "organizations", aliceOrg))).toEqual([
      MEMORY_ID,
    ]);
  });

  it("is for owners only: another account, or a non-owner role, is refused and nothing moves", async () => {
    const { graph } = await seedLocalWorkspace();
    await accounts.setMember(alice.id, aliceOrg, bob.id, "admin");

    await expect(adoption.adopt(bob.id, aliceOrg)).rejects.toBeInstanceOf(OrganizationAccessError);
    await expect(adoption.summary(bob.id, aliceOrg)).rejects.toBeInstanceOf(
      OrganizationAccessError,
    );

    // Still local: the refusal moved nothing.
    const [row] = await db().select().from(graphs).where(eq(graphs.id, graph.id));
    expect(row?.organizationId).toBeNull();
    await expect(adoption.adopt(alice.id, bob.id)).rejects.toBeInstanceOf(OrganizationAccessError);
  });

  it("refuses while a local run is still going, and moves nothing", async () => {
    const { run } = await seedLocalWorkspace();
    await db().update(runs).set({ status: "running" }).where(eq(runs.id, run.id));

    await expect(adoption.adopt(alice.id, aliceOrg)).rejects.toBeInstanceOf(LocalRunsActiveError);

    expect(await db().select().from(graphs).where(isNull(graphs.organizationId))).toHaveLength(1);
    expect(await db().select().from(secrets).where(isNull(secrets.organizationId))).toHaveLength(1);
  });

  it("refuses when the organization already has a secret with the same name, and moves nothing", async () => {
    await seedLocalWorkspace();
    const orgSecrets = new SecretsService(
      new DrizzleSecretRepository(testDb.database),
      new AesGcmSecretCipher(masterKey),
    );
    await resourceScope.run({ organizationId: aliceOrg }, () =>
      orgSecrets.set("anthropic", "já existe"),
    );

    await expect(adoption.adopt(alice.id, aliceOrg)).rejects.toBeInstanceOf(
      LocalSecretsConflictError,
    );

    expect(await db().select().from(graphs).where(isNull(graphs.organizationId))).toHaveLength(1);
    expect(await db().select().from(secrets).where(isNull(secrets.organizationId))).toHaveLength(1);
  });

  it("rolls back everything when a secret cannot be read with the current master key", async () => {
    await seedLocalWorkspace();
    const wrongKey = new LocalDataAdoption(
      testDb.database,
      testConfig({ dataDir, masterKey: randomBytes(32), localDataOrganizationId: aliceOrg }),
    );

    await expect(wrongKey.adopt(alice.id, aliceOrg)).rejects.toMatchObject({
      code: "local_secrets_unreadable",
    });

    expect(await db().select().from(graphs).where(isNull(graphs.organizationId))).toHaveLength(1);
  });
});

it("requires operator authorization and preserves the destination across config changes", async () => {
  await seedLocalWorkspace();
  const denied = new LocalDataAdoption(testDb.database, testConfig({ dataDir, masterKey }));
  await expect(denied.summary(alice.id, aliceOrg)).rejects.toBeInstanceOf(OrganizationAccessError);
  await expect(denied.adopt(alice.id, aliceOrg)).rejects.toBeInstanceOf(OrganizationAccessError);
  await adoption.adopt(alice.id, aliceOrg);
  const bobOrg = (await accounts.listOrganizations(bob.id))[0]!.id;
  const changed = new LocalDataAdoption(
    testDb.database,
    testConfig({ dataDir, masterKey, localDataOrganizationId: bobOrg }),
  );
  const pendingMemory = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await mkdir(path.join(dataDir, "memories", pendingMemory), { recursive: true });
  await expect(changed.adopt(bob.id, bobOrg)).rejects.toBeInstanceOf(OrganizationAccessError);
  expect((await adoption.adopt(alice.id, aliceOrg)).memories).toBe(1);
});
