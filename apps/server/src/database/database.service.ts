import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AppConfig, DatabaseConnection } from "../shared/config/app-config.js";
import { APP_CONFIG } from "../shared/config/tokens.js";
import { DatabaseNotConfiguredError } from "./database-not-configured.error.js";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;

const CONNECTION_TIMEOUT_MS = 2_000;

export function createPool(connection: DatabaseConnection): pg.Pool {
  return new pg.Pool({ ...connection, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
}

export function createDatabase(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}

/**
 * Owns the connection pool. The pool connects lazily, so the process can start (and report
 * the problem on /health) even when the database is not configured or not reachable yet.
 */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool?: pg.Pool;
  private readonly database?: Database;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (!config.database) return;
    this.pool = createPool(config.database);
    // An error on an idle client would otherwise crash the process.
    this.pool.on("error", (error) => this.logger.error(`Erro no pool do banco: ${error.message}`));
    this.database = createDatabase(this.pool);
  }

  get isConfigured(): boolean {
    return this.database !== undefined;
  }

  /** @throws DatabaseNotConfiguredError when no database variables were provided. */
  get db(): Database {
    if (!this.database) throw new DatabaseNotConfiguredError();
    return this.database;
  }

  async ping(): Promise<void> {
    if (!this.pool) throw new DatabaseNotConfiguredError();
    await this.pool.query("select 1");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }
}
