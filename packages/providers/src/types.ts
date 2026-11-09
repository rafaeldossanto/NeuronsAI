export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export interface FunctionTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ToolCall {
  id: string;
  name: string;
  input: string;
}
export interface ModelUsage {
  usageKnown?: boolean;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd?: number;
}
export interface ModelTurn {
  text?: string;
  calls: ToolCall[];
  usage: ModelUsage;
}
export interface TurnClient {
  addMessage(text: string): void;
  respond(briefing: string, tools: FunctionTool[], signal: AbortSignal): Promise<ModelTurn>;
  result: (call: ToolCall, text: string) => void;
}
export type ModelEvent =
  | { type: "text"; text: string }
  | { type: "toolCall"; call: ToolCall }
  | { type: "usage"; usage: ModelUsage }
  | { type: "done" };
export interface ModelProvider {
  name: string;
  createSession(model: string, key: string, effort: Effort): TurnClient;
}
