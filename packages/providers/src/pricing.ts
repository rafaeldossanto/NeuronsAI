import type { ModelUsage } from "./types.js";
export interface ModelPrice {
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite?: number;
  inputIncludesCache: boolean;
}
/** USD per million tokens, standard text requests; no batch, long-context, regional or tool surcharges. */
export const PRICE_VERSION = "2026-11-06";
export const PRICES: readonly ModelPrice[] = [
  {
    provider: "openai",
    model: "gpt-4.1-mini",
    input: 0.4,
    output: 1.6,
    cacheRead: 0.1,
    inputIncludesCache: true,
  },
  {
    provider: "openai",
    model: "gpt-4.1",
    input: 2,
    output: 8,
    cacheRead: 0.5,
    inputIncludesCache: true,
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
    inputIncludesCache: false,
  },
  {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    input: 1,
    output: 5,
    cacheRead: 0.1,
    cacheWrite: 1.25,
    inputIncludesCache: false,
  },
];
export class UsageCalculator {
  constructor(private readonly prices: readonly ModelPrice[] = PRICES) {}
  price(provider: string, model: string): ModelPrice | undefined {
    const canonical = model
      .replace(/-\d{4}-\d{2}-\d{2}$/, " ")
      .trim()
      .replace(/-\d{8}$/, "");
    return this.prices.find((p) => p.provider === provider && p.model === canonical);
  }
  calculate(provider: string, model: string, usage: ModelUsage): number | undefined {
    const p = this.price(provider, model);
    if (!p || usage.usageKnown === false) return undefined;
    const counts = [
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadTokens,
      usage.cacheCreationTokens,
    ];
    if (counts.some((n) => !Number.isSafeInteger(n) || n < 0)) return undefined;
    if (usage.cacheCreationTokens && p.cacheWrite === undefined) return undefined;
    if (p.inputIncludesCache && usage.cacheReadTokens > usage.inputTokens) return undefined;
    const input = p.inputIncludesCache
      ? usage.inputTokens - usage.cacheReadTokens
      : usage.inputTokens;
    return (
      (input * p.input +
        usage.outputTokens * p.output +
        usage.cacheReadTokens * p.cacheRead +
        usage.cacheCreationTokens * (p.cacheWrite ?? 0)) /
      1e6
    );
  }
}
