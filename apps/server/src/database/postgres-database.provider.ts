import { Logger } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import {
  type PostgresConnection,
  type PoolSettings,
  describeConnection,
  redactConnectionSecrets,
} from "../shared/config/database-config.js";
import type { DatabaseProvider } from "./database.provider.js";
import { MIGRATIONS_FOLDER } from "./migrations-folder.js";
import * as schema from "./schema/index.js";

const DEFAULT_CONNECTION_TIMEOUT_MS = 2_000;

/** Used when the caller gives none (tests): the same defaults as the environment variables. */
export const DEFAULT_POOL_SETTINGS: PoolSettings = {
  max: 10,
  idleTimeoutMs: 30_000,
  statementTimeoutMs: 30_000,
};

/**
 * A Postgres server reached through `pg`. The pool connects lazily, so the process can start (and
 * report the problem on /health) even when the server is not reachable yet.
 */
export class PostgresDatabaseProvider implements DatabaseProvider {
  readonly kind = "postgres";
  readonly description: string;
  readonly db: NodePgDatabase<typeof schema>;
  private readonly pool: pg.Pool;
  private readonly connection: PostgresConnection;
  private readonly logger = new Logger(PostgresDatabaseProvider.name);

  /**
   * @param connectionTimeoutMs how long to wait for a pooled connection, which counts both connecting
   * and queueing behind busy connections, so it must outlast a burst of transactions.
   */
  constructor(
    connection: PostgresConnection,
    connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS,
    pool: PoolSettings = DEFAULT_POOL_SETTINGS,
  ) {
    this.connection = connection;
    this.description = `Postgres em ${describeConnection(connection)}`;
    this.pool = new pg.Pool({
      ...connection,
      connectionTimeoutMillis: connectionTimeoutMs,
      max: pool.max,
      idleTimeoutMillis: pool.idleTimeoutMs,
      // 0 = no limit (the pg default). Applied by the server to every statement of the pool.
      statement_timeout: pool.statementTimeoutMs,
    });
    // An error on an idle client would otherwise crash the process.
    this.pool.on("error", (error) =>
      this.logger.error(`Erro no pool do banco: ${this.redactSecrets(error.message)}`),
    );
    this.db = drizzle(this.pool, { schema });
  }

  redactSecrets(text: string): string {
    return redactConnectionSecrets(text, this.connection);
  }

  /** On a connection of its own with no statement timeout: a slow migration must not be cut. */
  async migrate(): Promise<void> {
    const pool = new pg.Pool({ ...this.connection, max: 1, statement_timeout: 0 });
    pool.on("error", () => undefined);
    try {
      await migrate(drizzle(pool, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await pool.end();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
