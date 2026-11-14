export interface ToolLimits {
  /** Max characters of a tool result handed back to the agent. */
  maxResultChars: number;
  /** Upper bound for one HTTP request, on top of the caller's own signal. */
  httpTimeoutMs: number;
  /** How long an MCP server gets to connect and list its tools before the attempt is abandoned. */
  mcpConnectTimeoutMs: number;
  /** Max size of a single vault note read or searched. */
  maxNoteBytes: number;
  /** Max notes visited by one vault search. */
  maxSearchFiles: number;
}

export const DEFAULT_LIMITS: ToolLimits = {
  maxResultChars: 20_000,
  httpTimeoutMs: 30_000,
  mcpConnectTimeoutMs: 30_000,
  maxNoteBytes: 1024 * 1024,
  maxSearchFiles: 5_000,
};
