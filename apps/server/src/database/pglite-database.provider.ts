import { mkdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { DatabaseProvider } from "./database.provider.js";
import { MIGRATIONS_FOLDER } from "./migrations-folder.js";
import * as schema from "./schema/index.js";

/**
 * Postgres compiled to WASM, running inside the process: nothing to install for the desktop app.
 * It is a single connection, so transactions run one after the other (the client queues them).
 * Only one process may use a data folder at a time.
 */
export class PgliteDatabaseProvider implements DatabaseProvider {
  readonly kind = "embedded";
  readonly description: string;
  readonly db: PgliteDatabase<typeof schema>;

  private constructor(
    private readonly client: PGlite,
    dataDir: string | undefined,
  ) {
    this.description = `PGlite embutido em ${dataDir ?? "memória"}`;
    this.db = drizzle(client, { schema });
  }

  /** @param dataDir folder of the database files; omit to keep everything in memory (tests). */
  static async open(dataDir?: string): Promise<PgliteDatabaseProvider> {
    if (dataDir) await mkdir(dataDir, { recursive: true });
    const client = await PGlite.create(dataDir);
    return new PgliteDatabaseProvider(client, dataDir);
  }

  /** There is no credential to leak: the database is a local folder. */
  redactSecrets(text: string): string {
    return text;
  }

  async migrate(): Promise<void> {
    await migrate(this.db, { migrationsFolder: MIGRATIONS_FOLDER });
  }

  /** Waits for the queued work and flushes the files, so the folder is never left half-written. */
  async close(): Promise<void> {
    if (!this.client.closed) await this.client.close();
  }
}
