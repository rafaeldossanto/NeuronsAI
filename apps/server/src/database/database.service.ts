import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { DatabaseKind } from "../shared/config/app-config.js";
import { DatabaseNotConfiguredError } from "./database-not-configured.error.js";
import type { Database, DatabaseProvider } from "./database.provider.js";

export type { Database, DatabaseTransaction } from "./database.provider.js";

/**
 * What the rest of the app talks to: the chosen {@link DatabaseProvider}, or nothing when Postgres
 * was chosen without connection variables (the process still starts and /health reports it).
 */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(
    readonly kind: DatabaseKind,
    private readonly provider?: DatabaseProvider,
  ) {}

  get isConfigured(): boolean {
    return this.provider !== undefined;
  }

  /** @throws DatabaseNotConfiguredError when Postgres was chosen without connection variables. */
  get db(): Database {
    if (!this.provider) throw new DatabaseNotConfiguredError();
    return this.provider.db;
  }

  /** Masks the connection's credentials in `text`, which a driver may have echoed in an error. */
  redactSecrets(text: string): string {
    return this.provider?.redactSecrets(text) ?? text;
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.provider) return;
    await this.provider.close();
    this.logger.log(`Banco fechado (${this.provider.description}).`);
  }
}
