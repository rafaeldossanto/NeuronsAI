import { z } from "zod";
import { ConfigError } from "./config-error.js";
import { unlessEmpty } from "./env-schema.js";
import { DEFAULT_LISTEN_HOST, isLoopbackHost } from "./listen-config.js";

/**
 * The separate listener that serves only the webhook route (`POST /hooks/{hookId}`). A tunnel
 * points at this port and never at the API, which has no login.
 */
export interface HooksConfig {
  port: number;
  host: string;
  /** Biggest request body accepted on the hooks port, in bytes (the API's own limit does not apply). */
  maxBodyBytes: number;
  /** Requests per minute one trigger answers (a burst of that many is allowed), right or wrong. */
  ratePerMinute: number;
}

export const DEFAULT_HOOKS_MAX_BODY_KB = 256;
export const DEFAULT_HOOKS_RATE_PER_MIN = 60;

export const hooksEnvShape = {
  /** Unset (the default) leaves the hooks listener off. */
  NEURONS_HOOKS_PORT: unlessEmpty(z.coerce.number().int().min(1).max(65_535).optional()),
  NEURONS_HOOKS_HOST: unlessEmpty(z.string().trim().min(1).default(DEFAULT_LISTEN_HOST)),
  NEURONS_HOOKS_MAX_BODY_KB: unlessEmpty(
    z.coerce.number().int().min(1).max(10_240).default(DEFAULT_HOOKS_MAX_BODY_KB),
  ),
  NEURONS_HOOKS_RATE_PER_MIN: unlessEmpty(
    z.coerce.number().int().min(1).max(100_000).default(DEFAULT_HOOKS_RATE_PER_MIN),
  ),
};

export type HooksEnv = z.infer<z.ZodObject<typeof hooksEnvShape>>;

/**
 * `undefined` when `NEURONS_HOOKS_PORT` is not set. Like the API, the hooks port listens on
 * loopback unless `NEURONS_ALLOW_REMOTE=true`; a tunnel connects from this machine.
 */
export function resolveHooks(
  env: HooksEnv,
  listen: { allowRemote: boolean; apiPort: number },
): HooksConfig | undefined {
  const hooksPort = env.NEURONS_HOOKS_PORT;
  if (hooksPort === undefined) return undefined;
  const host = env.NEURONS_HOOKS_HOST;
  const problems: string[] = [];
  if (!isLoopbackHost(host) && !listen.allowRemote) {
    problems.push(
      "NEURONS_HOOKS_HOST: a porta dos gatilhos só aceita endereços locais (127.0.0.1, ::1, localhost); o túnel conecta daqui. Para escutar em outro endereço, defina também NEURONS_ALLOW_REMOTE=true.",
    );
  }
  if (hooksPort === listen.apiPort) {
    problems.push(
      "NEURONS_HOOKS_PORT: deve ser diferente de NEURONS_PORT; a porta dos gatilhos nunca serve a API.",
    );
  }
  if (problems.length > 0) throw new ConfigError(problems);
  return {
    port: hooksPort,
    host,
    maxBodyBytes: env.NEURONS_HOOKS_MAX_BODY_KB * 1024,
    ratePerMinute: env.NEURONS_HOOKS_RATE_PER_MIN,
  };
}
