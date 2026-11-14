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
/**
 * A piece of the reply as the model writes it. `toolArguments` carries a fragment of the JSON
 * arguments of a tool call (a prefix grows into the whole text; it is not valid JSON on its own).
 */
export type ModelDelta =
  | { type: "text"; text: string }
  | { type: "toolArguments"; callId: string; tool: string; text: string };

export interface RespondOptions {
  /**
   * Asks for the reply as a stream: the listener hears each piece while the model writes. The
   * returned {@link ModelTurn} is the same one a reply without it would be. A reply that is cut
   * (the connection dropped, the model stopped sending) rejects, never returns half a turn.
   */
  onDelta?: (delta: ModelDelta) => void;
}

export interface TurnClient {
  addMessage(text: string): void;
  respond(
    briefing: string,
    tools: FunctionTool[],
    signal: AbortSignal,
    options?: RespondOptions,
  ): Promise<ModelTurn>;
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
