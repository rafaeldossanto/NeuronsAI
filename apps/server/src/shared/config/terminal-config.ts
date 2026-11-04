import { z } from "zod";
import { unlessEmpty } from "./env-schema.js";

/** What a person typing into an agent's terminal (`terminal.input` on /ws) may send. */
export interface TerminalInputLimits {
  /** Characters in one message. A paste arrives as one, so this is also the biggest paste. */
  maxChars: number;
  /** Messages per second one connection may send (a burst of that many is allowed). */
  maxPerSecond: number;
}

export const DEFAULT_TERMINAL_INPUT_MAX_CHARS = 4_096;
export const DEFAULT_TERMINAL_INPUT_PER_SEC = 100;

export const terminalEnvShape = {
  NEURONS_TERMINAL_INPUT_MAX_CHARS: unlessEmpty(
    z.coerce.number().int().min(1).max(1_000_000).default(DEFAULT_TERMINAL_INPUT_MAX_CHARS),
  ),
  NEURONS_TERMINAL_INPUT_PER_SEC: unlessEmpty(
    z.coerce.number().int().min(1).max(10_000).default(DEFAULT_TERMINAL_INPUT_PER_SEC),
  ),
};

export type TerminalEnv = z.infer<z.ZodObject<typeof terminalEnvShape>>;

export function resolveTerminalInputLimits(env: TerminalEnv): TerminalInputLimits {
  return {
    maxChars: env.NEURONS_TERMINAL_INPUT_MAX_CHARS,
    maxPerSecond: env.NEURONS_TERMINAL_INPUT_PER_SEC,
  };
}
