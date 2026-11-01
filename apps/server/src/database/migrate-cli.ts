import { ConfigError, loadConfig } from "../shared/config/app-config.js";
import { createDatabase, createPool } from "./database.service.js";
import { runMigrations } from "./migrate.js";

async function main(): Promise<void> {
  const { database } = loadConfig();
  if (!database)
    throw new ConfigError([
      "banco não configurado: defina NEURONS_DB_URL ou NEURONS_DB_HOST/USER/NAME/PASSWORD",
    ]);

  const pool = createPool(database);
  try {
    await runMigrations(createDatabase(pool));
    console.log("Migrations aplicadas.");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
