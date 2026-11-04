import { mkdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { DatabaseProvider } from "./database.provider.js";
import { DirectoryLock } from "./directory-lock.js";
import { MIGRATIONS_FOLDER } from "./migrations-folder.js";
import * as schema from "./schema/index.js";

/**
 * Postgres compiled to WASM, running inside the process: nothing to install for the desktop app.
 * It is a single connection, so transactions run one after the other (the client queues them).
 * Only one process may use a data folder at a time: `open` takes a lock file (`<folder>.lock`, beside
 * the folder, never inside what PGlite owns) and fails with `DataDirLockedError` if a live process
 * already holds it.
 */
export class PgliteDatabaseProvider implements DatabaseProvider {
  readonly kind = "embedded";
  readonly description: string;
  readonly db: PgliteDatabase<typeof schema>;

  private constructor(
    private readonly client: PGlite,
    dataDir: string | undefined,
    private readonly lock: DirectoryLock | undefined,
  ) {
    this.description = `PGlite embutido em ${dataDir ?? "memória"}`;
    this.db = drizzle(client, { schema });
  }

  /** @param dataDir folder of the database files; omit to keep everything in memory (tests). */
  static async open(dataDir?: string): Promise<PgliteDatabaseProvider> {
    if (!dataDir) return new PgliteDatabaseProvider(await PGlite.create(), dataDir, undefined);
    const lock = await DirectoryLock.acquire(dataDir, `${dataDir}.lock`);
    try {
      await mkdir(dataDir, { recursive: true });
      return new PgliteDatabaseProvider(await PGlite.create(dataDir), dataDir, lock);
    } catch (error) {
      await lock.release();
      throw error;
    }
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
    try {
      if (!this.client.closed) await this.client.close();
    } finally {
      await this.lock?.release();
    }
  }
}
