import { checkCron, isValidTimezone, nextCronRuns, systemTimezone } from "@neurons/graph-schema";
import cronstrue from "cronstrue";
import "cronstrue/locales/pt_BR";

/** The cron in plain Portuguese ("Às 09:00, somente segunda-feira"), or null when it is not valid. */
export function describeCron(expression: string): string | null {
  if (!checkCron(expression).ok) return null;
  try {
    return cronstrue.toString(expression.trim(), {
      locale: "pt_BR",
      use24HourTimeFormat: true,
      throwExceptionOnParseError: true,
    });
  } catch {
    return null;
  }
}

/** The next moments the cron fires, in the zone it is read in (the computer's when none is named). */
export function upcomingRuns(
  expression: string,
  timezone: string | undefined,
  count = 3,
  from: Date = new Date(),
): Date[] {
  return nextCronRuns(expression, {
    count,
    from,
    ...(timezone ? { timezone } : {}),
  });
}

/** `seg., 09 de nov., 09:00`, as read in the zone. */
export function formatMoment(moment: Date, timezone: string | undefined): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...(timezone && isValidTimezone(timezone) ? { timeZone: timezone } : {}),
  }).format(moment);
}

export function localTimezone(): string {
  return systemTimezone();
}

/**
 * A signed call, ready for a POSIX shell. The secret is read from `NEURONS_WEBHOOK_SECRET`, so
 * the example never holds it: set it from where you saved it when it was generated.
 */
export function curlExample(url: string): string {
  return [
    `BODY='{"mensagem":"Olá!"}'`,
    `TS=$(date +%s)`,
    `SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$NEURONS_WEBHOOK_SECRET" -hex | sed 's/^.* //')`,
    `curl -X POST '${url}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H "X-Neurons-Timestamp: $TS" \\`,
    `  -H "X-Neurons-Signature: sha256=$SIG" \\`,
    `  --data-binary "$BODY"`,
  ].join("\n");
}

export const OUTCOME_LABELS = {
  started: "Iniciou uma execução",
  skipped_overlap: "Pulada: a execução anterior ainda rodava",
  skipped_missed: "Horário perdido (não foi recuperado)",
  failed: "Não conseguiu iniciar a execução",
} as const;
