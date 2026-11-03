import { z } from "zod";
import { unlessEmpty } from "./env-schema.js";

/**
 * Where the agents run (decision D14): `local` hosts them in this process (an embedded runner),
 * `hybrid` and `hosted` leave them to runners that connect to this server. Until the cloud phase
 * (T26) `hosted` behaves as `hybrid`: the difference is who operates the runners.
 */
export const PROFILES = ["local", "hybrid", "hosted"] as const;
export type Profile = (typeof PROFILES)[number];

export const DEFAULT_RUNNER_GRACE_SEC = 60;
export const DEFAULT_RUNNER_HEARTBEAT_SEC = 15;
export const DEFAULT_RUNNER_WAIT_SEC = 30;

export interface RunnerLimits {
  /** How long a runner that lost its connection may take to come back before its agents fail. */
  graceMs: number;
  /** How often each side proves it is alive; three missed beats close the connection. */
  heartbeatMs: number;
  /** How long starting an agent waits for a runner to be connected. */
  waitMs: number;
}

export const runnerEnvShape = {
  NEURONS_PROFILE: unlessEmpty(z.enum(PROFILES).default("local")),
  NEURONS_RUNNER_GRACE_SEC: unlessEmpty(
    z.coerce.number().int().min(1).default(DEFAULT_RUNNER_GRACE_SEC),
  ),
  NEURONS_RUNNER_HEARTBEAT_SEC: unlessEmpty(
    z.coerce.number().int().min(1).default(DEFAULT_RUNNER_HEARTBEAT_SEC),
  ),
  NEURONS_RUNNER_WAIT_SEC: unlessEmpty(
    z.coerce.number().int().min(0).default(DEFAULT_RUNNER_WAIT_SEC),
  ),
};

export type RunnerEnv = z.infer<z.ZodObject<typeof runnerEnvShape>>;

export function resolveRunnerLimits(env: RunnerEnv): RunnerLimits {
  return {
    graceMs: env.NEURONS_RUNNER_GRACE_SEC * 1000,
    heartbeatMs: env.NEURONS_RUNNER_HEARTBEAT_SEC * 1000,
    waitMs: env.NEURONS_RUNNER_WAIT_SEC * 1000,
  };
}
