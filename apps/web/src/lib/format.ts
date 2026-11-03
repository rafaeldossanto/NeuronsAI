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
