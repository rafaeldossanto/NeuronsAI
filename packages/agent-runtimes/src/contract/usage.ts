/** Default for how long a runtime's `stop` waits for a closing turn to report its usage: a closing turn is a short answer, not new work. */
export const DEFAULT_USAGE_FLUSH_MS = 4_000;

/** What one turn of an agent consumed, as the CLI or the provider reports it. */
export interface AgentUsage {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Absent when the runtime has no price (a subscription reports it as notional anyway). */
  costUsd?: number;
  durationMs?: number;
  /** Model round trips inside the turn. */
  turns?: number;
}
