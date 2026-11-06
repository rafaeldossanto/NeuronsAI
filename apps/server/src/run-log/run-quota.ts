import type { QuotaLimits } from "../shared/config/quota-config.js";
import { QuotaExceededError } from "../shared/errors/quota-exceeded.error.js";

/** The limits on runs that apply inside an organization (`0` turns one off). */
export type RunQuotas = Pick<
  QuotaLimits,
  "concurrentRunsPerOrganization" | "runsPerDayPerOrganization"
>;

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Judges counts that were taken **inside the transaction that creates the run** (under a lock per
 * organization), so two starts at the same moment cannot both read "one slot left".
 * @throws QuotaExceededError
 */
export function assertRunQuota(
  counts: { active: number; startedInLastDay: number },
  limits: RunQuotas,
): void {
  const concurrent = limits.concurrentRunsPerOrganization;
  if (concurrent > 0 && counts.active >= concurrent) {
    throw new QuotaExceededError(
      "quota_concurrent_runs",
      `Sua organização já tem ${concurrent} ${concurrent === 1 ? "execução" : "execuções"} em andamento, o limite. Espere alguma terminar ou pare uma.`,
    );
  }
  const perDay = limits.runsPerDayPerOrganization;
  if (perDay > 0 && counts.startedInLastDay >= perDay) {
    throw new QuotaExceededError(
      "quota_runs_per_day",
      `Sua organização atingiu o limite de ${perDay} execuções nas últimas 24 horas. Tente de novo mais tarde.`,
    );
  }
}
