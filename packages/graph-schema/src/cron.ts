import { Cron } from "croner";

/** Why a cron expression or a time zone was refused (pt-BR, for the user). */
export type CronCheck = { ok: true } | { ok: false; message: string };

const CRON_FORMAT_HINT =
  'Use 5 campos (minuto hora dia-do-mês mês dia-da-semana), como "0 9 * * 1" para toda segunda às 9h.';

/** The time zone of this machine, which a schedule uses when the trigger names none. */
export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** An IANA name the runtime knows (`America/Sao_Paulo`, `UTC`). */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone.trim() !== "";
  } catch {
    return false;
  }
}

function build(expression: string, timezone?: string): Cron {
  return new Cron(expression.trim(), { ...(timezone ? { timezone } : {}), legacyMode: true });
}

/**
 * Checks a standard 5-field cron expression. Nicknames (`@daily`), a seconds field and
 * expressions that never happen (31 de fevereiro) are refused.
 */
export function checkCron(expression: string): CronCheck {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return { ok: false, message: `Expressão cron inválida. ${CRON_FORMAT_HINT}` };
  }
  let cron: Cron;
  try {
    cron = build(expression);
  } catch {
    return { ok: false, message: `Expressão cron inválida. ${CRON_FORMAT_HINT}` };
  }
  if (cron.nextRun() === null) {
    return { ok: false, message: "Essa expressão cron nunca dispara: confira o dia e o mês." };
  }
  return { ok: true };
}

/**
 * The next `count` moments after `from` at which the expression fires in the time zone (the
 * system's when absent). Empty when the expression or the zone is invalid.
 */
export function nextCronRuns(
  expression: string,
  options: { timezone?: string; from?: Date; count?: number } = {},
): Date[] {
  if (!checkCron(expression).ok) return [];
  if (options.timezone !== undefined && !isValidTimezone(options.timezone)) return [];
  const cron = build(expression, options.timezone);
  return cron.nextRuns(options.count ?? 1, options.from ?? new Date());
}

/** The next moment after `from`, or `undefined` when there is none (or the input is invalid). */
export function nextCronRun(
  expression: string,
  options: { timezone?: string; from?: Date } = {},
): Date | undefined {
  return nextCronRuns(expression, { ...options, count: 1 })[0];
}
