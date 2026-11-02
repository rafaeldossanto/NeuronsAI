import { DEFAULT_USAGE_FLUSH_MS } from "@neurons/agent-runtimes";
import { z } from "zod";
import { unlessEmpty } from "./env-schema.js";

/** Limits that keep a run from going on forever or spending without bound. */
export interface GuardLimits {
  /** Messages (of any kind) a run may exchange before it is stopped. */
  runMaxMessages: number;
  /** Messages the same two agents may exchange, with nobody else involved, before the run is stopped. */
  pingPongMessages: number;
  /** Spending limit of a run that does not set its own; absent means no limit. */
  runBudgetUsd?: number;
}

export const DEFAULT_RUN_MAX_MESSAGES = 200;
export const DEFAULT_PING_PONG_MESSAGES = 20;

export const guardEnvShape = {
  NEURONS_RUN_MAX_MESSAGES: unlessEmpty(
    z.coerce.number().int().min(1).default(DEFAULT_RUN_MAX_MESSAGES),
  ),
  NEURONS_PING_PONG_MESSAGES: unlessEmpty(
    z.coerce.number().int().min(2).default(DEFAULT_PING_PONG_MESSAGES),
  ),
  NEURONS_RUN_BUDGET_USD: unlessEmpty(z.coerce.number().positive().optional()),
  NEURONS_USAGE_FLUSH_MS: unlessEmpty(
    z.coerce.number().int().min(0).default(DEFAULT_USAGE_FLUSH_MS),
  ),
};

export type GuardEnv = z.infer<z.ZodObject<typeof guardEnvShape>>;

export function resolveGuardLimits(env: GuardEnv): GuardLimits {
  return {
    runMaxMessages: env.NEURONS_RUN_MAX_MESSAGES,
    pingPongMessages: env.NEURONS_PING_PONG_MESSAGES,
    ...(env.NEURONS_RUN_BUDGET_USD !== undefined && { runBudgetUsd: env.NEURONS_RUN_BUDGET_USD }),
  };
}
