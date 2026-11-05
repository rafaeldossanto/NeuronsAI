import { eq } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "../database/database.service.js";
import { graphs, graphVersions, runs } from "../database/schema/index.js";
import { RunNotFoundError } from "../run-log/run-log.errors.js";
import { GraphVersionNotFoundError } from "../runs/runs.errors.js";
import { resourceScope, type ResourceScope } from "./resource-scope.js";

/** Used for work that already has an authenticated resource id, never for a client-selected org. */
export async function scopeOfRun(
  db: Database | DatabaseTransaction,
  runId: string,
): Promise<ResourceScope> {
  const [row] = await db
    .select({ organizationId: graphs.organizationId })
    .from(runs)
    .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
    .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
    .where(eq(runs.id, runId));
  if (!row) throw new RunNotFoundError(runId);
  return row;
}

export async function requireOwnedVersion(
  db: Database | DatabaseTransaction,
  versionId: string,
): Promise<void> {
  const [row] = await db
    .select({ organizationId: graphs.organizationId })
    .from(graphVersions)
    .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
    .where(eq(graphVersions.id, versionId));
  if (!row || row.organizationId !== resourceScope.current().organizationId)
    throw new GraphVersionNotFoundError(versionId);
}

export async function requireOwnedRun(
  db: Database | DatabaseTransaction,
  runId: string,
): Promise<void> {
  const scope = await scopeOfRun(db, runId);
  if (scope.organizationId !== resourceScope.current().organizationId)
    throw new RunNotFoundError(runId);
}
