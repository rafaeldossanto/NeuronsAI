/**
 * What a tool call leaves in the run log: enough to follow what an agent did, never what it
 * received. Structurally the same as the `ToolCallRecord` of `@neurons/tools`, so a runtime hands
 * the one to the other (`onCall: (record) => communication.reportToolCall(record)`).
 */
export interface ToolCallReport {
  /** Name of the tool as the agent called it. */
  tool: string;
  /**
   * The input in a short, secret-free rendering. A value that came from `{{secret:NAME}}` shows as
   * the placeholder (the name), never as the value; long texts are cut.
   */
  inputSummary: string;
  durationMs: number;
  ok: boolean;
  /** Why the call failed, when it did. */
  errorCode?: string;
}
