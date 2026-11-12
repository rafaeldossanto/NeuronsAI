import { randomUUID } from "node:crypto";
import twoAgents from "@neurons/graph-schema/examples/two-agents.json" with { type: "json" };
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AccountsService } from "../accounts/accounts.service.js";
import { resourceScope } from "../accounts/resource-scope.js";
import { SignupPolicy } from "../accounts/signup-policy.js";
import { rowsOf, startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { DrizzleRunRepository } from "../run-log/drizzle-run.repository.js";
import { DrizzleGraphVersionRepository } from "./drizzle-graph-version.repository.js";
import { DrizzleGraphRepository } from "./drizzle-graph.repository.js";
import { GraphVersionService, usesSecrets } from "./graph-version.service.js";
import { SecretPublishForbiddenError } from "./graphs.errors.js";

/**
 * Upgrade of a database that already holds organization graphs published before migration
 * 0013_credential_approval (the 14th, so the first 13 are the older ones). Those versions have no
 * approval, so using credentials from them must stay blocked until an owner/admin republishes.
 */
const BEFORE_APPROVAL = 13;

let testDb: TestDatabase;
const db = () => testDb.database.db;

const withCredential = (id: string) => ({
  ...twoAgents,
  id,
  nodes: twoAgents.nodes.map((node) =>
    node.id === "agente-pesquisador"
      ? { ...node, runtime: { ...node.runtime, secretName: "CHAVE" } }
      : node,
  ),
});
const withoutCredential = (id: string) => ({ ...twoAgents, id });

interface Seeded {
  graphId: string;
  runId: string;
}

/** Plain SQL on purpose: this is the schema of the old release, with no `credentials_approved`. */
async function seed(organizationId: string | null, definition: object): Promise<Seeded> {
  const graphId = randomUUID();
  const draft = JSON.stringify(definition);
  const published = JSON.stringify({ ...definition, id: graphId });
  await db().execute(
    sql`insert into graphs (id, name, draft, organization_id) values (${graphId}, 'Antigo', ${draft}::jsonb, ${organizationId})`,
  );
  const [version] = rowsOf<{ id: string }>(
    await db().execute(
      sql`insert into graph_versions (graph_id, version, definition) values (${graphId}, 1, ${published}::jsonb) returning id`,
    ),
  );
  const [run] = rowsOf<{ id: string }>(
    await db().execute(
      sql`insert into runs (graph_version_id, status) values (${version!.id}, 'running') returning id`,
    ),
  );
  return { graphId, runId: run!.id };
}

let orgId: string;
let orgWithCredentials: Seeded;
let orgWithoutCredentials: Seeded;
let local: Seeded;

beforeAll(async () => {
  testDb = await startTestDatabase(undefined, { migrationsUpTo: BEFORE_APPROVAL });
  const accounts = new AccountsService(testDb.database, SignupPolicy.open());
  const owner = await accounts.provisionIdentity({
    issuer: "https://identity.example.invalid",
    subject: "credential-approval",
    displayName: "Pessoa de teste",
  });
  orgId = (await accounts.listOrganizations(owner.id))[0]!.id;

  orgWithCredentials = await seed(orgId, withCredential("x"));
  orgWithoutCredentials = await seed(orgId, withoutCredential("x"));
  local = await seed(null, withCredential("x"));

  await testDb.migrate(); // applies 0013 on top of the data above
});

afterAll(async () => {
  await testDb.stop();
});

/** The rule the supervisor and RunService apply (see supervisor.ts and run.service.ts). */
async function blockedFromUsingCredentials(seeded: Seeded): Promise<boolean> {
  const running = await new DrizzleRunRepository(testDb.database).listRunning();
  const entry = running.find((item) => item.run.id === seeded.runId)!;
  return Boolean(entry.organizationId) && usesSecrets(entry.graph) && !entry.credentialsApproved;
}

it("adds the approval column to what already exists, unapproved", async () => {
  const rows = rowsOf<{ credentials_approved: boolean }>(
    await db().execute(sql`select credentials_approved from graph_versions`),
  );
  expect(rows).toHaveLength(3);
  expect(rows.every((row) => row.credentials_approved === false)).toBe(true);
});

it("blocks credential use from an old organization version, and only when it has credentials", async () => {
  expect(await blockedFromUsingCredentials(orgWithCredentials)).toBe(true);
  expect(await blockedFromUsingCredentials(orgWithoutCredentials)).toBe(false);
});

it("does not change the profile without an organization", async () => {
  expect(await blockedFromUsingCredentials(local)).toBe(false);
});

it("approves on republishing by an owner/admin, and keeps refusing a member", async () => {
  const versions = new GraphVersionService(
    new DrizzleGraphRepository(testDb.database),
    new DrizzleGraphVersionRepository(testDb.database),
  );
  const graphId = orgWithCredentials.graphId;
  const definition = withCredential(graphId);

  await expect(
    resourceScope.run({ organizationId: orgId, role: "member" }, () =>
      versions.publish(graphId, definition),
    ),
  ).rejects.toBeInstanceOf(SecretPublishForbiddenError);

  const published = await resourceScope.run({ organizationId: orgId, role: "admin" }, () =>
    versions.publish(graphId, definition),
  );
  expect(published.ok).toBe(true);

  const rows = rowsOf<{ version: number; credentials_approved: boolean }>(
    await db().execute(
      sql`select version, credentials_approved from graph_versions where graph_id = ${graphId} order by version`,
    ),
  );
  expect(rows).toEqual([
    { version: 1, credentials_approved: false },
    { version: 2, credentials_approved: true },
  ]);
});
