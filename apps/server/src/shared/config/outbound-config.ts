import { z } from "zod";
import { ConfigError } from "./config-error.js";
import { csvList } from "./env-schema.js";
import type { Profile } from "./runner-config.js";

/** What the HTTP and MCP-over-HTTP tools may reach. Only present on a server that is not `local`. */
export interface OutboundConfig {
  allowedPorts: number[];
  /** Hosts (exact, `*.suffix` or IP literal) exempt from the address and port checks. */
  allowHosts: string[];
}

const DEFAULT_PORTS = [80, 443];

export const outboundEnvShape = {
  NEURONS_OUTBOUND_ALLOWED_PORTS: csvList(),
  NEURONS_OUTBOUND_ALLOW_HOSTS: csvList(),
};

export type OutboundEnv = z.infer<z.ZodObject<typeof outboundEnvShape>>;

const HOST_ENTRY = /^(\*\.)?[a-z0-9]([a-z0-9.:-]*[a-z0-9])?$/;

/**
 * On `hybrid`/`hosted` the tools run in the server process, so private networks, loopback and the
 * cloud metadata address are refused (see `@neurons/tools`). The `local` profile is the user's own
 * machine, where calling their own localhost is the point, so it stays unrestricted.
 */
export function resolveOutbound(env: OutboundEnv, profile: Profile): OutboundConfig | undefined {
  if (profile === "local") return undefined;
  const ports = env.NEURONS_OUTBOUND_ALLOWED_PORTS.map(Number);
  if (ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new ConfigError(["NEURONS_OUTBOUND_ALLOWED_PORTS deve listar portas de 1 a 65535."]);
  }
  const badHost = env.NEURONS_OUTBOUND_ALLOW_HOSTS.find((entry) => !HOST_ENTRY.test(entry));
  if (badHost) {
    throw new ConfigError([
      "NEURONS_OUTBOUND_ALLOW_HOSTS deve listar nomes de host, *.sufixo ou IPs, sem esquema nem caminho.",
    ]);
  }
  return {
    allowedPorts: ports.length ? [...new Set(ports)] : DEFAULT_PORTS,
    allowHosts: env.NEURONS_OUTBOUND_ALLOW_HOSTS,
  };
}
