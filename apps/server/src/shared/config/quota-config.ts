import { z } from "zod";
import { unlessEmpty } from "./env-schema.js";

/**
 * What one organization may hold or run. They apply only where there are organizations (a server
 * with accounts); the `local` profile without an account has no quotas. `0` turns a limit off.
 */
export interface QuotaLimits {
  /** Organizations one account may own, counting the personal space made at signup. */
  organizationsPerUser: number;
  /** Memories (vaults) one organization keeps. */
  memoriesPerOrganization: number;
  /** Total size of the files of all the memories of one organization, in bytes. */
  memoryBytesPerOrganization: number;
  /** Runs of one organization going at the same time. */
  concurrentRunsPerOrganization: number;
  /** Runs one organization starts in any 24 hours (a rolling window, not the calendar day). */
  runsPerDayPerOrganization: number;
}

export const DEFAULT_QUOTAS: QuotaLimits = {
  organizationsPerUser: 5,
  memoriesPerOrganization: 50,
  memoryBytesPerOrganization: 512 * 1024 * 1024,
  concurrentRunsPerOrganization: 5,
  runsPerDayPerOrganization: 500,
};

const BYTES_PER_MB = 1024 * 1024;
const count = (fallback: number) => unlessEmpty(z.coerce.number().int().min(0).default(fallback));

export const quotaEnvShape = {
  NEURONS_QUOTA_ORGANIZATIONS_PER_USER: count(DEFAULT_QUOTAS.organizationsPerUser),
  NEURONS_QUOTA_MEMORIES_PER_ORG: count(DEFAULT_QUOTAS.memoriesPerOrganization),
  NEURONS_QUOTA_MEMORY_MB_PER_ORG: count(DEFAULT_QUOTAS.memoryBytesPerOrganization / BYTES_PER_MB),
  NEURONS_QUOTA_CONCURRENT_RUNS_PER_ORG: count(DEFAULT_QUOTAS.concurrentRunsPerOrganization),
  NEURONS_QUOTA_RUNS_PER_DAY_PER_ORG: count(DEFAULT_QUOTAS.runsPerDayPerOrganization),
};

export type QuotaEnv = z.infer<z.ZodObject<typeof quotaEnvShape>>;

export function resolveQuotas(env: QuotaEnv): QuotaLimits {
  return {
    organizationsPerUser: env.NEURONS_QUOTA_ORGANIZATIONS_PER_USER,
    memoriesPerOrganization: env.NEURONS_QUOTA_MEMORIES_PER_ORG,
    memoryBytesPerOrganization: env.NEURONS_QUOTA_MEMORY_MB_PER_ORG * BYTES_PER_MB,
    concurrentRunsPerOrganization: env.NEURONS_QUOTA_CONCURRENT_RUNS_PER_ORG,
    runsPerDayPerOrganization: env.NEURONS_QUOTA_RUNS_PER_DAY_PER_ORG,
  };
}
