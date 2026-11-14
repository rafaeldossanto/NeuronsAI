import path from "node:path";
import type { AppConfig } from "../shared/config/app-config.js";
import type { DatabaseProvider } from "./database.provider.js";
import { PgliteDatabaseProvider } from "./pglite-database.provider.js";
import { PostgresDatabaseProvider } from "./postgres-database.provider.js";

/** The embedded database lives in this subfolder of NEURONS_DATA_DIR. */
export const EMBEDDED_DB_FOLDER = "db";

/** Opens the provider the config asks for; `undefined` when Postgres was chosen but not configured. */
export async function openDatabaseProvider(
  config: Pick<AppConfig, "dataDir" | "database">,
): Promise<DatabaseProvider | undefined> {
  const { database } = config;
  if (database.kind === "embedded") {
    return PgliteDatabaseProvider.open(path.join(config.dataDir, EMBEDDED_DB_FOLDER));
  }
  return database.connection
    ? new PostgresDatabaseProvider(database.connection, undefined, database.pool)
    : undefined;
}
