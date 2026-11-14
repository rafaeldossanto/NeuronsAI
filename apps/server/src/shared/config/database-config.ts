import { z } from "zod";
import { ConfigError } from "./config-error.js";
import { port, unlessEmpty } from "./env-schema.js";

export const DATABASE_KINDS = ["embedded", "postgres"] as const;
export type DatabaseKind = (typeof DATABASE_KINDS)[number];

export type PostgresConnection =
  | { connectionString: string }
  | { host: string; port: number; user: string; password: string; database: string };

/** How the Postgres pool behaves. The embedded database is one connection and ignores it. */
export interface PoolSettings {
  /** Most connections open at once. */
  max: number;
  /** How long an idle connection is kept before it is closed. */
  idleTimeoutMs: number;
  /** A query running longer than this is cancelled by the server; 0 means no limit. Migrations ignore it. */
  statementTimeoutMs: number;
}

export type DatabaseConfig =
  | { kind: "embedded" }
  /** `connection` is absent when no Postgres variables were provided; `pool` falls back to the defaults. */
  | { kind: "postgres"; connection?: PostgresConnection; pool?: PoolSettings };

export const databaseEnvShape = {
  NEURONS_DB: unlessEmpty(z.enum(DATABASE_KINDS).default("embedded")),
  NEURONS_DB_URL: unlessEmpty(z.url().optional()),
  NEURONS_DB_HOST: unlessEmpty(z.string().trim().min(1).optional()),
  NEURONS_DB_PORT: port(5432),
  NEURONS_DB_USER: unlessEmpty(z.string().trim().min(1).optional()),
  NEURONS_DB_NAME: unlessEmpty(z.string().trim().min(1).optional()),
  NEURONS_DB_PASSWORD: unlessEmpty(z.string().min(1).optional()),
  NEURONS_DB_POOL_MAX: unlessEmpty(z.coerce.number().int().min(1).max(500).default(10)),
  NEURONS_DB_IDLE_TIMEOUT_MS: unlessEmpty(z.coerce.number().int().min(0).default(30_000)),
  NEURONS_DB_STATEMENT_TIMEOUT_MS: unlessEmpty(z.coerce.number().int().min(0).default(30_000)),
};

export type DatabaseEnv = z.infer<z.ZodObject<typeof databaseEnvShape>>;

const REQUIRED_POSTGRES_VARIABLES = [
  "NEURONS_DB_HOST",
  "NEURONS_DB_USER",
  "NEURONS_DB_NAME",
  "NEURONS_DB_PASSWORD",
] as const;

/** The Postgres variables only count when NEURONS_DB=postgres; the embedded database ignores them. */
export function resolveDatabase(env: DatabaseEnv): DatabaseConfig {
  if (env.NEURONS_DB === "embedded") return { kind: "embedded" };
  const connection = resolvePostgresConnection(env);
  return {
    kind: "postgres",
    ...(connection && { connection }),
    pool: {
      max: env.NEURONS_DB_POOL_MAX,
      idleTimeoutMs: env.NEURONS_DB_IDLE_TIMEOUT_MS,
      statementTimeoutMs: env.NEURONS_DB_STATEMENT_TIMEOUT_MS,
    },
  };
}

function resolvePostgresConnection(env: DatabaseEnv): PostgresConnection | undefined {
  if (env.NEURONS_DB_URL) return { connectionString: env.NEURONS_DB_URL };

  const { NEURONS_DB_HOST: host, NEURONS_DB_USER: user, NEURONS_DB_NAME: database } = env;
  const { NEURONS_DB_PASSWORD: password } = env;
  if (!host && !user && !database && !password) return undefined;

  if (!host || !user || !database || !password) {
    const missing = REQUIRED_POSTGRES_VARIABLES.filter((variable) => !env[variable]);
    throw new ConfigError([
      `banco incompleto: defina também ${missing.join(", ")} (ou use NEURONS_DB_URL)`,
    ]);
  }
  return { host, port: env.NEURONS_DB_PORT, user, password, database };
}

const MASK = "***";

/** A connection description that is safe to log: the password is masked. */
export function describeConnection(connection: PostgresConnection): string {
  if ("connectionString" in connection) {
    try {
      const url = new URL(connection.connectionString);
      if (url.password) url.password = MASK;
      return url.toString();
    } catch {
      return "(URL de conexão inválida)";
    }
  }
  const { user, host, port: portNumber, database } = connection;
  return `postgres://${user}:${MASK}@${host}:${portNumber}/${database}`;
}

/** Every secret a connection carries, in the shapes it may show up in an error message. */
function secretsOf(connection: PostgresConnection): string[] {
  if (!("connectionString" in connection)) return [connection.password];
  try {
    const { password } = new URL(connection.connectionString);
    return password ? [password, decodeURIComponent(password)] : [];
  } catch {
    return [];
  }
}

/** Masks the connection's secrets in `text`, e.g. an error message raised by the driver. */
export function redactConnectionSecrets(text: string, connection: PostgresConnection): string {
  return secretsOf(connection).reduce((safe, secret) => safe.replaceAll(secret, MASK), text);
}
