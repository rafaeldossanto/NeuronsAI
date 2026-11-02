import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

const POSTGRES_IMAGE = "postgres:18";

/**
 * Starts one Postgres 18 for the whole integration run (starting a container per suite is slow);
 * each suite gets its own database inside it, see `startTestDatabase`.
 */
export default async function setup({ provide }: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  provide("postgresAdminUri", container.getConnectionUri());
  return async () => {
    await container.stop();
  };
}
