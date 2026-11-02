import { randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";
import type { DatabaseKind } from "../../shared/config/app-config.js";
import type { DatabaseProvider } from "../database.provider.js";
import { DatabaseService } from "../database.service.js";
import { PgliteDatabaseProvider } from "../pglite-database.provider.js";
import { PostgresDatabaseProvider } from "../postgres-database.provider.js";

declare module "vitest" {
  interface ProvidedContext {
    /** Which database the integration suites run against; set per project in the vitest configs. */
    databaseKind: DatabaseKind;
    /** Superuser URI of the Postgres started by postgres-global-setup.ts (postgres project only). */
    postgresAdminUri?: string;
  }
}

export interface TestDatabase {
  database: DatabaseService;
  /** Applies the migrations again (they are idempotent). */
  migrate(): Promise<void>;
  stop(): Promise<void>;
}

interface RunningProvider {
  provider: DatabaseProvider;
  teardown?: () => Promise<void>;
}

function startProvider(kind: DatabaseKind): Promise<RunningProvider> {
  return kind === "embedded" ? startEmbedded() : startPostgres();
}

async function startEmbedded(): Promise<RunningProvider> {
  return { provider: await PgliteDatabaseProvider.open() };
}

/** A fresh, empty database on the shared Postgres, so suites never see each other's rows. */
async function startPostgres(): Promise<RunningProvider> {
  const adminUri = inject("postgresAdminUri");
  if (!adminUri) throw new Error("postgres-global-setup.ts não rodou: falta postgresAdminUri.");

  const name = `neurons_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: adminUri });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }

  const uri = new URL(adminUri);
  uri.pathname = `/${name}`;
  return {
    // Generous: the concurrency suites queue dozens of transactions on a busy machine.
    provider: new PostgresDatabaseProvider({ connectionString: uri.toString() }, 60_000),
    teardown: async () => {
      const dropper = new pg.Client({ connectionString: adminUri });
      await dropper.connect();
      try {
        await dropper.query(`drop database "${name}" with (force)`);
      } finally {
        await dropper.end();
      }
    },
  };
}

/**
 * Starts a throwaway database of the kind the current vitest project asks for (an in-memory PGlite,
 * or a database on the Postgres 18 of the Docker run) and applies every migration to it.
 */
export async function startTestDatabase(
  kind: DatabaseKind = inject("databaseKind"),
): Promise<TestDatabase> {
  const { provider, teardown } = await startProvider(kind);
  await provider.migrate();
  const database = new DatabaseService(kind, provider);

  return {
    database,
    migrate: () => provider.migrate(),
    async stop() {
      await database.onApplicationShutdown();
      await teardown?.();
    },
  };
}

/** Both drivers return `{ rows }` from `db.execute`, but Drizzle's common base types it as unknown. */
export function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}
