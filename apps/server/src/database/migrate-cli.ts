import { ConfigError, loadConfig } from "../shared/config/app-config.js";
import { openDatabaseProvider } from "./open-database-provider.js";

async function main(): Promise<void> {
  const provider = await openDatabaseProvider(loadConfig());
  if (!provider)
    throw new ConfigError([
      "banco não configurado: defina NEURONS_DB_URL ou NEURONS_DB_HOST/USER/NAME/PASSWORD",
    ]);

  try {
    await provider.migrate();
    console.log(`Migrations aplicadas (${provider.description}).`);
  } finally {
    await provider.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
