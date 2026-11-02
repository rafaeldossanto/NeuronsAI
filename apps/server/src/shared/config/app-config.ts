import os from "node:os";
import { z } from "zod";
import { ConfigError } from "./config-error.js";
import { type HostInfo, resolveDataDir } from "./data-dir.js";
import { type DatabaseConfig, databaseEnvShape, resolveDatabase } from "./database-config.js";
import { port, unlessEmpty } from "./env-schema.js";

export { ConfigError } from "./config-error.js";
export { DATABASE_KINDS } from "./database-config.js";
export type { DatabaseConfig, DatabaseKind, PostgresConnection } from "./database-config.js";

export const APP_MODES = ["api", "worker", "all"] as const;
export type AppMode = (typeof APP_MODES)[number];

/** The server only listens on loopback in v1. */
export const LISTEN_HOST = "127.0.0.1";

export interface AppConfig {
  mode: AppMode;
  port: number;
  /** How long an agent's `ask` waits for the answer before failing. */
  askTimeoutMs: number;
  /** Folder where the app keeps its data (the embedded database lives in its `db` subfolder). */
  dataDir: string;
  database: DatabaseConfig;
  /** 32 raw bytes decoded from NEURONS_MASTER_KEY. Absent when not provided. */
  masterKey?: Buffer;
}

const BASE64_32_BYTES = /^[A-Za-z0-9+/]{43}=$/;

const envSchema = z.object({
  NEURONS_MODE: unlessEmpty(z.enum(APP_MODES).default("all")),
  NEURONS_PORT: port(3100),
  NEURONS_ASK_TIMEOUT_SEC: unlessEmpty(z.coerce.number().int().min(1).default(120)),
  NEURONS_DATA_DIR: unlessEmpty(z.string().trim().min(1).optional()),
  ...databaseEnvShape,
  NEURONS_MASTER_KEY: unlessEmpty(
    z
      .string()
      .trim()
      .regex(BASE64_32_BYTES, "deve ser uma chave de 32 bytes codificada em base64")
      .optional(),
  ),
});

const currentHost = (): HostInfo => ({ platform: process.platform, homedir: os.homedir() });

/**
 * Parses and validates the environment; throws a {@link ConfigError} listing every problem found.
 * `host` only matters for the default data folder and is injectable for tests.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  host: HostInfo = currentHost(),
): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const values = parsed.data;
  const masterKey = values.NEURONS_MASTER_KEY;

  return {
    mode: values.NEURONS_MODE,
    port: values.NEURONS_PORT,
    askTimeoutMs: values.NEURONS_ASK_TIMEOUT_SEC * 1000,
    dataDir: resolveDataDir(values.NEURONS_DATA_DIR, env, host),
    database: resolveDatabase(values),
    ...(masterKey && { masterKey: Buffer.from(masterKey, "base64") }),
  };
}
