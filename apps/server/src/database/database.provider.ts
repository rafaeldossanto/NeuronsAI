import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { DatabaseKind } from "../shared/config/app-config.js";
import type * as schema from "./schema/index.js";

/** Drizzle's common Postgres base: repositories use it without knowing which driver is behind. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Port for one way of running the Postgres schema: an embedded PGlite or a Postgres server. */
export interface DatabaseProvider {
  readonly kind: DatabaseKind;
  /** Where the data lives, safe to log (no secrets). */
  readonly description: string;
  readonly db: Database;
  /** Masks any credential of the connection in `text`, e.g. an error message raised by a driver. */
  redactSecrets(text: string): string;
  /** Applies every pending migration of apps/server/drizzle. */
  migrate(): Promise<void>;
  /** Releases the connection(s); the data stays consistent on disk. */
  close(): Promise<void>;
}
