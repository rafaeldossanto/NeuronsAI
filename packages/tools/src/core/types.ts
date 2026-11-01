import type { SecretResolver } from "./secrets.js";

/** JSON Schema describing the input an agent must provide to call a tool. */
export type JsonSchema = Record<string, unknown>;

export type ToolErrorCode =
  | "INVALID_INPUT"
  | "SECRET_NOT_FOUND"
  | "ABORTED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "MCP_ERROR"
  | "NOT_FOUND"
  | "PATH_FORBIDDEN"
  | "FILE_TOO_LARGE"
  | "INTERNAL_ERROR";

export interface ToolError {
  code: ToolErrorCode;
  message: string;
}

export type ToolResult =
  { ok: true; content: string; truncated: boolean } | { ok: false; error: ToolError };

/** What the server turns into the `ToolCalled` event. Never carries secrets. */
export interface ToolCallRecord {
  tool: string;
  inputSummary: string;
  durationMs: number;
  ok: boolean;
  errorCode?: ToolErrorCode;
}

export interface ToolContext {
  signal: AbortSignal;
  secrets: SecretResolver;
  onCall?: (record: ToolCallRecord) => void;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolSet {
  tools: Tool[];
  close(): Promise<void>;
}
