import { SecretNotFoundError } from "./secrets.js";
import type { ToolError, ToolErrorCode, ToolResult } from "./types.js";

export function success(content: string): ToolResult {
  return { ok: true, content, truncated: false };
}

export function failure(code: ToolErrorCode, message: string): ToolResult {
  return { ok: false, error: { code, message } };
}

export function truncateResult(result: ToolResult, maxChars: number): ToolResult {
  if (!result.ok || result.content.length <= maxChars) return result;
  const notice = "\n[resultado truncado]";
  return { ok: true, content: result.content.slice(0, maxChars) + notice, truncated: true };
}

/** Why an aborted call stopped: the caller's timeout or an explicit cancellation. */
export function abortFailure(signal: AbortSignal): ToolResult {
  const reason: unknown = signal.reason;
  const timedOut = reason instanceof Error && reason.name === "TimeoutError";
  return timedOut
    ? failure("TIMEOUT", "A ferramenta excedeu o tempo limite.")
    : failure("ABORTED", "A chamada à ferramenta foi cancelada.");
}

/** Last-resort mapping so `execute` never rejects. */
export function failureFromThrown(error: unknown, signal: AbortSignal): ToolResult {
  if (signal.aborted) return abortFailure(signal);
  if (error instanceof SecretNotFoundError) return failure("SECRET_NOT_FOUND", error.message);
  const message = error instanceof Error ? error.message : String(error);
  return failure("INTERNAL_ERROR", `Falha inesperada na ferramenta: ${message}`);
}

export function errorOf(result: ToolResult): ToolError | undefined {
  return result.ok ? undefined : result.error;
}
