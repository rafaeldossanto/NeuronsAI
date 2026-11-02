import { z } from "zod";

export const APP_MODES = ["api", "worker", "all"] as const;
export type AppMode = (typeof APP_MODES)[number];

/** The server only listens on loopback in v1. */
export const LISTEN_HOST = "127.0.0.1";

export type DatabaseConnection =
  | { connectionString: string }
  | { host: string; port: number; user: string; password: string; database: string };

export interface AppConfig {
  mode: AppMode;
  port: number;
  /** How long an agent's `ask` waits for the answer before failing. */
  askTimeoutMs: number;
  /** Absent when no database variables were provided. */
  database?: DatabaseConnection;
  /** 32 raw bytes decoded from NEURONS_MASTER_KEY. Absent when not provided. */
  masterKey?: Buffer;
  /** Path of the Claude Code executable (NEURONS_CLAUDE_BIN); absent means "find it". */
  claudeBin?: string;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuração inválida:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

const BASE64_32_BYTES = /^[A-Za-z0-9+/]{43}=$/;

/** An empty variable (as left blank in .env.example) means "not set". */
const unlessEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const port = (fallback: number) =>
  unlessEmpty(z.coerce.number().int().min(1).max(65_535).default(fallback));

const envSchema = z.object({
  NEURONS_MODE: unlessEmpty(z.enum(APP_MODES).default("all")),
  NEURONS_PORT: port(3100),
  NEURONS_ASK_TIMEOUT_SEC: unlessEmpty(z.coerce.number().int().min(1).default(120)),
  NEURONS_DB_URL: unlessEmpty(z.url().optional()),
  NEURONS_DB_HOST: unlessEmpty(z.string().trim().min(1).optional()),
  NEURONS_DB_PORT: port(5432),
  NEURONS_DB_USER: unlessEmpty(z.string().trim().min(1).optional()),
  NEURONS_DB_NAME: unlessEmpty(z.string().trim().min(1).optional()),
  NEURONS_DB_PASSWORD: unlessEmpty(z.string().min(1).optional()),
  NEURONS_CLAUDE_BIN: unlessEmpty(z.string().trim().min(1).optional()),
  NEURONS_MASTER_KEY: unlessEmpty(
    z
      .string()
      .trim()
      .regex(BASE64_32_BYTES, "deve ser uma chave de 32 bytes codificada em base64")
      .optional(),
  ),
});

type Env = z.infer<typeof envSchema>;

const REQUIRED_DB_VARIABLES = [
  "NEURONS_DB_HOST",
  "NEURONS_DB_USER",
  "NEURONS_DB_NAME",
  "NEURONS_DB_PASSWORD",
] as const;

function resolveDatabase(env: Env): DatabaseConnection | undefined {
  if (env.NEURONS_DB_URL) return { connectionString: env.NEURONS_DB_URL };

  const { NEURONS_DB_HOST: host, NEURONS_DB_USER: user, NEURONS_DB_NAME: database } = env;
  const { NEURONS_DB_PASSWORD: password } = env;
  if (!host && !user && !database && !password) return undefined;

  if (!host || !user || !database || !password) {
    const missing = REQUIRED_DB_VARIABLES.filter((variable) => !env[variable]);
    throw new ConfigError([
      `banco incompleto: defina também ${missing.join(", ")} (ou use NEURONS_DB_URL)`,
    ]);
  }
  return { host, port: env.NEURONS_DB_PORT, user, password, database };
}

/** Parses and validates the environment; throws a {@link ConfigError} listing every problem found. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const values = parsed.data;
  const database = resolveDatabase(values);
  const masterKey = values.NEURONS_MASTER_KEY;

  return {
    mode: values.NEURONS_MODE,
    port: values.NEURONS_PORT,
    askTimeoutMs: values.NEURONS_ASK_TIMEOUT_SEC * 1000,
    ...(database && { database }),
    ...(masterKey && { masterKey: Buffer.from(masterKey, "base64") }),
    ...(values.NEURONS_CLAUDE_BIN && { claudeBin: values.NEURONS_CLAUDE_BIN }),
  };
}
