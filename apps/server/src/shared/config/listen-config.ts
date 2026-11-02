import { z } from "zod";
import { ConfigError } from "./config-error.js";
import { unlessEmpty } from "./env-schema.js";

/** The server has no login yet, so by default only this machine can reach it. */
export const DEFAULT_LISTEN_HOST = "127.0.0.1";

export const listenEnvShape = {
  NEURONS_HOST: unlessEmpty(z.string().trim().min(1).default(DEFAULT_LISTEN_HOST)),
  NEURONS_ALLOW_REMOTE: unlessEmpty(
    z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  ),
};

export type ListenEnv = z.infer<z.ZodObject<typeof listenEnvShape>>;

/** `127.0.0.0/8`, `::1` and `localhost`. */
export function isLoopbackHost(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return bare === "::1" || bare.toLowerCase() === "localhost" || /^127(\.\d{1,3}){3}$/.test(bare);
}

/**
 * Where the server listens. Anything but loopback is an explicit opt-in (`NEURONS_ALLOW_REMOTE`),
 * because anyone who can reach the port can use the API: there is no authentication yet.
 */
export function resolveListenHost(env: ListenEnv): string {
  const host = env.NEURONS_HOST;
  if (!isLoopbackHost(host) && !env.NEURONS_ALLOW_REMOTE) {
    throw new ConfigError([
      "NEURONS_HOST: o servidor ainda não tem login, então só aceita endereços locais (127.0.0.1, ::1, localhost). Para escutar em outro endereço, defina também NEURONS_ALLOW_REMOTE=true.",
    ]);
  }
  return host;
}
