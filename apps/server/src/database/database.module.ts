import { Logger, Module } from "@nestjs/common";
import type { AppConfig } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { DatabaseService } from "./database.service.js";
import { openDatabaseProvider } from "./open-database-provider.js";

@Module({
  providers: [
    {
      provide: DatabaseService,
      inject: [APP_CONFIG],
      // Async so that the embedded database is open and migrated before anything uses it.
      useFactory: async (config: AppConfig) => {
        const provider = await openDatabaseProvider(config);
        if (provider?.kind === "embedded") {
          // The desktop user has no way to run a migrate command. Postgres is migrated with
          // `db:migrate`, so that several instances of the cloud server never race on it.
          await provider.migrate();
        }
        if (provider) new Logger("Database").log(`Banco: ${provider.description}.`);
        return new DatabaseService(config.database.kind, provider);
      },
    },
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
