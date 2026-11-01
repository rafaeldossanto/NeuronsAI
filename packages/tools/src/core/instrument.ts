import type { ToolLimits } from "./limits.js";
import { errorOf, failureFromThrown, truncateResult } from "./results.js";
import { summarizeInput } from "./summary.js";
import type { Tool } from "./types.js";

/**
 * Cross-cutting behaviour applied to every tool exactly once, whatever its kind:
 * `execute` never rejects, results are truncated and each call is reported via `onCall`.
 */
export function instrument(tool: Tool, limits: Pick<ToolLimits, "maxResultChars">): Tool {
  return {
    ...tool,
    async execute(input, ctx) {
      const startedAt = performance.now();
      let result;
      try {
        result = truncateResult(await tool.execute(input, ctx), limits.maxResultChars);
      } catch (error) {
        result = failureFromThrown(error, ctx.signal);
      }
      const errorCode = errorOf(result)?.code;
      try {
        ctx.onCall?.({
          tool: tool.name,
          inputSummary: summarizeInput(input),
          durationMs: Math.round(performance.now() - startedAt),
          ok: result.ok,
          ...(errorCode ? { errorCode } : {}),
        });
      } catch {
        // A faulty listener must not change the outcome of the call.
      }
      return result;
    },
  };
}
