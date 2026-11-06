import twoAgents from "@neurons/graph-schema/examples/two-agents.json" with { type: "json" };
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountsService } from "../accounts/accounts.service.js";
import { resourceScope } from "../accounts/resource-scope.js";
import { SignupPolicy } from "../accounts/signup-policy.js";
import { startTestDatabase, type TestDatabase } from "../database/testing/test-database.js";
import { DrizzleGraphRepository } from "../graphs/drizzle-graph.repository.js";
import { DrizzleGraphVersionRepository } from "../graphs/drizzle-graph-version.repository.js";
import { GraphVersionService } from "../graphs/graph-version.service.js";
import { QuotaExceededError } from "../shared/errors/quota-exceeded.error.js";
import { DrizzleRunRepository } from "./drizzle-run.repository.js";

/** The limits on runs are checked inside the transaction that creates the run: parallel starts cannot pass them. */

let testDb: TestDatabase;
let repository: DrizzleRunRepository;
const organization: Record<"a" | "b", { id: string; version: string }> = {
  a: { id: "", version: "" },
  b: { id: "", version: "" },
};

beforeAll(async () => {
  testDb = await startTestDatabase();
  repository = new DrizzleRunRepository(testDb.database);
  const accounts = new AccountsService(testDb.database, SignupPolicy.open());
  const graphs = new DrizzleGraphRepository(testDb.database);
  const versions = new GraphVersionService(
    graphs,
    new DrizzleGraphVersionRepository(testDb.database),
  );
  for (const key of ["a", "b"] as const) {
    const user = await accounts.provisionIdentity({
      issuer: "https://identity.example.invalid",
      subject: `quota-${key}`,
      displayName: `Pessoa ${key}`,
    });
    const id = (await accounts.listOrganizations(user.id))[0]!.id;
    organization[key].id = id;
    await resourceScope.run({ organizationId: id }, async () => {
      const graph = await graphs.create({ name: `Grafo ${key}` });
      const published = await versions.publish(graph.id, { ...twoAgents, id: graph.id });
      if (!published.ok) throw new Error("grafo de exemplo inválido");
      organization[key].version = published.version.id;
    });
  }
});

afterAll(async () => {
  await testDb.stop();
});

const start = (key: "a" | "b", quotas: { concurrent: number; perDay: number }) =>
  resourceScope.run({ organizationId: organization[key].id }, () =>
    repository.createRunning(organization[key].version, () => [], {
      quotas: {
        concurrentRunsPerOrganization: quotas.concurrent,
        runsPerDayPerOrganization: quotas.perDay,
      },
    }),
  );

describe("limits on runs, checked where the run is created", () => {
  it("lets exactly the limit through when many starts arrive at the same moment", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => start("a", { concurrent: 3, perDay: 0 })),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    const refused = results.filter((result) => result.status === "rejected");
    expect(refused).toHaveLength(5);
    for (const result of refused) {
      expect(result.reason).toBeInstanceOf(QuotaExceededError);
      expect(result.reason).toMatchObject({ code: "quota_concurrent_runs" });
    }
  });

  it("counts only the organization's own runs", async () => {
    // Organization "a" is full from the case above; "b" is untouched.
    await expect(start("b", { concurrent: 3, perDay: 0 })).resolves.toBeDefined();
    await expect(start("a", { concurrent: 3, perDay: 0 })).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
  });

  it("holds the daily limit against parallel starts too, and 0 turns a limit off", async () => {
    // "b" has 1 run in the last 24 hours; allow 4 in total: 3 more get in out of 6.
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => start("b", { concurrent: 0, perDay: 4 })),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    expect(
      results.find((result) => result.status === "rejected" && result.reason !== undefined),
    ).toMatchObject({ reason: { code: "quota_runs_per_day" } });

    await expect(start("b", { concurrent: 0, perDay: 0 })).resolves.toBeDefined();
  });
});
