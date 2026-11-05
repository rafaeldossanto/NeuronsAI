import os from "node:os";
import { z } from "zod";
import { ConfigError } from "./config-error.js";
import { type HostInfo, resolveDataDir } from "./data-dir.js";
import { type DatabaseConfig, databaseEnvShape, resolveDatabase } from "./database-config.js";
import { type GuardLimits, guardEnvShape, resolveGuardLimits } from "./guard-config.js";
import { port, unlessEmpty } from "./env-schema.js";
import { type HooksConfig, hooksEnvShape, resolveHooks } from "./hooks-config.js";
import { listenEnvShape, resolveListenHost } from "./listen-config.js";
import { type OutboundConfig, outboundEnvShape, resolveOutbound } from "./outbound-config.js";
import { authEnvShape, resolveAuth, type AuthConfig } from "./auth-config.js";
import {
  type TerminalInputLimits,
  resolveTerminalInputLimits,
  terminalEnvShape,
} from "./terminal-config.js";
import {
  type Profile,
  type RunnerLimits,
  resolveRunnerLimits,
  runnerEnvShape,
} from "./runner-config.js";

export { ConfigError } from "./config-error.js";
export { DATABASE_KINDS } from "./database-config.js";
export type { GuardLimits } from "./guard-config.js";
export type { HooksConfig } from "./hooks-config.js";
export { PROFILES } from "./runner-config.js";
export type { OutboundConfig } from "./outbound-config.js";
export type { SignupConfig } from "./auth-config.js";
export type { Profile, RunnerLimits } from "./runner-config.js";
export type { TerminalInputLimits } from "./terminal-config.js";
export type { DatabaseConfig, DatabaseKind, PostgresConnection } from "./database-config.js";

export const APP_MODES = ["api", "worker", "all"] as const;
export type AppMode = (typeof APP_MODES)[number];

export interface AppConfig {
  /** Optional OIDC settings for hybrid/hosted. Absent: account-free local workspace. */
  auth?: AuthConfig;
  /**
   * What the HTTP / MCP-over-HTTP tools may reach. Absent on the `local` profile (the user's own
   * machine); present on `hybrid`/`hosted`, where it keeps tools away from internal networks.
   */
  outbound?: OutboundConfig;
  uiRoot?: string;
  landingRoot?: string;
  mode: AppMode;
  /** Where the server listens: loopback unless `NEURONS_ALLOW_REMOTE` says otherwise. */
  host: string;
  port: number;
  /**
   * The separate listener for external triggers (webhooks). Absent means off, which is the default:
   * only then does nothing outside this machine's API port receive anything.
   */
  hooks?: HooksConfig;
  /** How long an agent's `ask` waits for the answer before failing. */
  askTimeoutMs: number;
  guards: GuardLimits;
  /** Size and rate limits of what is typed into an agent's terminal. */
  terminalInput: TerminalInputLimits;
  /** Where the agents run (see {@link Profile}). */
  profile: Profile;
  runners: RunnerLimits;
  /** How long stopping a run waits for the agents' last usage report (see `NEURONS_USAGE_FLUSH_MS`). */
  usageFlushMs: number;
  /** Folder where the app keeps its data (the embedded database lives in its `db` subfolder). */
  dataDir: string;
  database: DatabaseConfig;
  /** 32 raw bytes decoded from NEURONS_MASTER_KEY. Absent when not provided. */
  masterKey?: Buffer;
  /** Path of the Claude Code executable (NEURONS_CLAUDE_BIN); absent means "find it". */
  claudeBin?: string;
  /**
   * What to run as the Claude Code CLI, program and leading arguments. Not an environment variable:
   * set in code by whoever embeds the server (the demo points it at the fake CLI).
   */
  claudeCommand?: { command: string; args: string[] };
  /**
   * How agents' Claude Code starts the `neurons` MCP server. Set in code by whoever embeds the
   * server in something that is not plain Node (the desktop app runs Electron as Node here).
   */
  mcpServer?: { command: string; args: string[]; env?: Record<string, string> };
}

const BASE64_32_BYTES = /^[A-Za-z0-9+/]{43}=$/;

const envSchema = z.object({
  ...authEnvShape,
  ...outboundEnvShape,
  NEURONS_UI_DIR: unlessEmpty(z.string().min(1).optional()),
  NEURONS_LANDING_DIR: unlessEmpty(z.string().min(1).optional()),
  NEURONS_MODE: unlessEmpty(z.enum(APP_MODES).default("all")),
  ...listenEnvShape,
  ...hooksEnvShape,
  NEURONS_PORT: port(3100),
  NEURONS_ASK_TIMEOUT_SEC: unlessEmpty(z.coerce.number().int().min(1).default(120)),
  NEURONS_DATA_DIR: unlessEmpty(z.string().trim().min(1).optional()),
  ...databaseEnvShape,
  ...guardEnvShape,
  ...terminalEnvShape,
  ...runnerEnvShape,
  NEURONS_CLAUDE_BIN: unlessEmpty(z.string().trim().min(1).optional()),
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
  const auth = resolveAuth({
    NEURONS_PUBLIC_ORIGIN: values.NEURONS_PUBLIC_ORIGIN,
    NEURONS_GOOGLE_CLIENT_ID: values.NEURONS_GOOGLE_CLIENT_ID,
    NEURONS_GOOGLE_CLIENT_SECRET: values.NEURONS_GOOGLE_CLIENT_SECRET,
    NEURONS_GOOGLE_REDIRECT_URI: values.NEURONS_GOOGLE_REDIRECT_URI,
    NEURONS_SIGNUP_ALLOWED_DOMAINS: values.NEURONS_SIGNUP_ALLOWED_DOMAINS,
    NEURONS_SIGNUP_ALLOWED_EMAILS: values.NEURONS_SIGNUP_ALLOWED_EMAILS,
    NEURONS_SIGNUP_OPEN: values.NEURONS_SIGNUP_OPEN,
  });
  const outbound = resolveOutbound(values, values.NEURONS_PROFILE);
  if (auth && (!masterKey || values.NEURONS_PROFILE === "local"))
    throw new ConfigError([
      "Contas exigem NEURONS_MASTER_KEY e perfil hybrid ou hosted. O perfil local continua sem conta.",
    ]);

  const hooks = resolveHooks(values, {
    allowRemote: values.NEURONS_ALLOW_REMOTE,
    apiPort: values.NEURONS_PORT,
  });

  return {
    ...(auth && { auth }),
    ...(outbound && { outbound }),
    ...(values.NEURONS_UI_DIR && { uiRoot: values.NEURONS_UI_DIR }),
    ...(values.NEURONS_LANDING_DIR && { landingRoot: values.NEURONS_LANDING_DIR }),
    mode: values.NEURONS_MODE,
    host: resolveListenHost(values),
    port: values.NEURONS_PORT,
    ...(hooks && { hooks }),
    askTimeoutMs: values.NEURONS_ASK_TIMEOUT_SEC * 1000,
    guards: resolveGuardLimits(values),
    terminalInput: resolveTerminalInputLimits(values),
    profile: values.NEURONS_PROFILE,
    runners: resolveRunnerLimits(values),
    usageFlushMs: values.NEURONS_USAGE_FLUSH_MS,
    dataDir: resolveDataDir(values.NEURONS_DATA_DIR, env, host),
    database: resolveDatabase(values),
    ...(masterKey && { masterKey: Buffer.from(masterKey, "base64") }),
    ...(values.NEURONS_CLAUDE_BIN && { claudeBin: values.NEURONS_CLAUDE_BIN }),
  };
}
