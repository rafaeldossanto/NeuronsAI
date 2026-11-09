const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const time = new Intl.DateTimeFormat("pt-BR", { timeStyle: "medium" });
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

export const formatDateTime = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : "—");
export const formatTime = (iso: string) => time.format(new Date(iso));
export const formatUsd = (value: number) => usd.format(value);

export const runStatusLabel = {
  pending: "Pendente",
  running: "Em execução",
  succeeded: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
} as const;

/** `1 min 5 s`, `12 s`, `340 ms`; a dash while the run has not finished. */
export function formatDuration(ms: number | null) {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
