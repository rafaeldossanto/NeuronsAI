import type { Effort } from "./types.js";
/** Omit unsupported/unknown options instead of sending a field a model rejects. */
export function supportedEffort(
  provider: string,
  model: string,
  effort: Effort,
): Effort | undefined {
  if (provider === "openai") {
    if (/^gpt-6/.test(model)) return effort;
    if (/^(o[134](?:-|$)|gpt-5)/.test(model))
      return effort === "max" || effort === "xhigh" ? "high" : effort;
  }
  if (provider === "anthropic" && /^claude-(?:opus|sonnet)-(?:4-[6789]|5)/.test(model))
    return effort === "max" || effort === "xhigh" ? "high" : effort;
  return undefined;
}
