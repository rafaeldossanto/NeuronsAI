import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { DatabaseService } from "../database.service.js";
import { runMigrations } from "../migrate.js";

const POSTGRES_IMAGE = "postgres:18";

export interface TestDatabase {
  database: DatabaseService;
  stop(): Promise<void>;
}

/** Starts a throwaway Postgres 18 in Docker and applies every migration to it. */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const database = new DatabaseService({
    mode: "api",
    port: 0,
    database: { connectionString: container.getConnectionUri() },
  });
  await runMigrations(database.db);

  return {
    database,
    async stop() {
      await database.onApplicationShutdown();
      await container.stop();
    },
  };
}
