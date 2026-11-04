import type { ToolLimits } from "./limits.js";
import { errorOf, failureFromThrown, truncateResult } from "./results.js";
import { scrubSecrets, type SecretResolver } from "./secrets.js";
import { summarizeInput } from "./summary.js";
import type { Tool } from "./types.js";

/** A resolver that remembers the values it handed out, so they can be kept out of what is reported. */
function recordingResolver(inner: SecretResolver, values: string[]): SecretResolver {
  return {
    async resolve(name) {
      const value = await inner.resolve(name);
      values.push(value);
      return value;
    },
  };
}

/**
 * Cross-cutting behaviour applied to every tool exactly once, whatever its kind:
 * `execute` never rejects, results are truncated and each call is reported via `onCall`.
 */
export function instrument(tool: Tool, limits: Pick<ToolLimits, "maxResultChars">): Tool {
  return {
    ...tool,
    async execute(input, ctx) {
      const startedAt = performance.now();
      const secretValues: string[] = [];
      let result;
      try {
        const context = { ...ctx, secrets: recordingResolver(ctx.secrets, secretValues) };
        result = truncateResult(await tool.execute(input, context), limits.maxResultChars);
      } catch (error) {
        result = failureFromThrown(error, ctx.signal);
      }
      const errorCode = errorOf(result)?.code;
      try {
        ctx.onCall?.({
          tool: tool.name,
          // The summary comes from the input, which only names secrets; scrubbing the values the
          // call resolved is the second lock, for an agent that wrote one out in full.
          inputSummary: scrubSecrets(summarizeInput(input), secretValues),
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
