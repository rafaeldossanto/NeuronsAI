import { z } from "zod";
import { BRIDGE_TOKEN_MIN_LENGTH } from "./protocol.js";

export interface McpConfig {
  bridgeUrl: string;
  bridgeToken: string;
  /** How long the Hub lets an `ask` wait; the bridge call must outlive it. */
  askTimeoutMs?: number;
}

export class McpConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuração inválida do MCP neurons:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "McpConfigError";
  }
}

const LOOPBACK_URL = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;

const envSchema = z.object({
  NEURONS_BRIDGE_URL: z.string().regex(LOOPBACK_URL, {
    error: "deve ser o endereço local da ponte (http://127.0.0.1:<porta>)",
  }),
  NEURONS_BRIDGE_TOKEN: z.string().min(BRIDGE_TOKEN_MIN_LENGTH, {
    error: `deve ter ao menos ${BRIDGE_TOKEN_MIN_LENGTH} caracteres`,
  }),
  NEURONS_ASK_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
});

/**
 * The only reader of the environment of this program (the runtime that spawns it passes the
 * address and the token of its bridge through the MCP config). The token is never logged.
 */
export function loadMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new McpConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const values = parsed.data;
  return {
    bridgeUrl: values.NEURONS_BRIDGE_URL,
    bridgeToken: values.NEURONS_BRIDGE_TOKEN,
    ...(values.NEURONS_ASK_TIMEOUT_MS && { askTimeoutMs: values.NEURONS_ASK_TIMEOUT_MS }),
  };
}
