import OpenAI from "openai";
import type { TurnClient, FunctionTool, ToolCall, ModelTurn } from "./types.js";
/** Base URL is operator configuration, never supplied by a graph. */
export class OpenAICompatibleTurnClient implements TurnClient {
  private messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  private client: OpenAI;
  constructor(
    private model: string,
    key: string,
    baseURL: string,
    fetcher?: typeof fetch,
  ) {
    this.client = new OpenAI({
      apiKey: key,
      baseURL,
      maxRetries: 2,
      timeout: 90000,
      ...(fetcher && { fetch: fetcher }),
    });
  }
  addMessage(text: string) {
    this.messages.push({ role: "user", content: text });
  }
  async respond(briefing: string, tools: FunctionTool[], signal: AbortSignal): Promise<ModelTurn> {
    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: [{ role: "system", content: briefing }, ...this.messages],
        tools: tools.map((tool) => ({ type: "function" as const, function: tool })),
      },
      { signal },
    );
    const message = response.choices[0]?.message;
    if (!message) throw new Error("Empty model response");
    this.messages.push(message);
    return {
      text: message.content ?? "",
      calls: (message.tool_calls ?? []).flatMap((call) =>
        call.type === "function"
          ? [{ id: call.id, name: call.function.name, input: call.function.arguments }]
          : [],
      ),
      usage: {
        usageKnown: response.usage != null,
        model: response.model,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        cacheReadTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheCreationTokens: 0,
      },
    };
  }
  result(call: ToolCall, text: string) {
    this.messages.push({ role: "tool", tool_call_id: call.id, content: text });
  }
}
