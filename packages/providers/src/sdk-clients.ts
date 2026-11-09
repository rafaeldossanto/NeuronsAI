import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { Effort, FunctionTool, ToolCall, ModelTurn, TurnClient } from "./types.js";
import { supportedEffort } from "./capabilities.js";
export class OpenAITurnClient implements TurnClient {
  private readonly messages: OpenAI.Responses.ResponseInputItem[] = [];
  private readonly client: OpenAI;
  constructor(
    private readonly model: string,
    key: string,
    private readonly effort: Effort,
    fetcher?: typeof fetch,
  ) {
    this.client = new OpenAI({
      apiKey: key,
      maxRetries: 2,
      timeout: 90_000,
      ...(fetcher && { fetch: fetcher }),
    });
  }
  addMessage(text: string) {
    this.messages.push({ role: "user", content: text });
  }
  async respond(briefing: string, tools: FunctionTool[], signal: AbortSignal): Promise<ModelTurn> {
    const effort = supportedEffort("openai", this.model, this.effort);
    const response = await this.client.responses.create(
      {
        model: this.model,
        instructions: briefing,
        input: this.messages,
        store: false,
        // Without storage, reasoning items only round-trip when their encrypted content comes along.
        include: ["reasoning.encrypted_content"],
        max_output_tokens: 8192,
        ...(effort && { reasoning: { effort } }),
        tools: tools.map((tool) => ({ type: "function" as const, ...tool, strict: false })),
      },
      { signal },
    );
    this.messages.push(...(response.output as OpenAI.Responses.ResponseInputItem[]));
    return {
      text: response.output_text,
      calls: response.output.flatMap((item) =>
        item.type === "function_call"
          ? [{ id: item.call_id, name: item.name, input: item.arguments }]
          : [],
      ),
      usage: {
        usageKnown: response.usage != null,
        model: response.model,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
        cacheCreationTokens: 0,
      },
    };
  }
  result(call: ToolCall, text: string) {
    this.messages.push({ type: "function_call_output", call_id: call.id, output: text });
  }
}

export class AnthropicTurnClient implements TurnClient {
  private readonly messages: Anthropic.MessageParam[] = [];
  private readonly client: Anthropic;
  constructor(
    private readonly model: string,
    key: string,
    private readonly effort: Effort,
    fetcher?: typeof fetch,
  ) {
    this.client = new Anthropic({
      apiKey: key,
      maxRetries: 2,
      timeout: 90_000,
      ...(fetcher && { fetch: fetcher }),
    });
  }
  addMessage(text: string) {
    this.messages.push({ role: "user", content: text });
  }
  async respond(briefing: string, tools: FunctionTool[], signal: AbortSignal): Promise<ModelTurn> {
    const effort = supportedEffort("anthropic", this.model, this.effort);
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 8192,
        system: briefing,
        messages: this.messages,
        ...(effort && { output_config: { effort } }),
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: { ...tool.parameters, type: "object" as const },
        })),
      },
      { signal },
    );
    this.messages.push({ role: "assistant", content: response.content });
    return {
      text: response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join(""),
      calls: response.content.flatMap((block) =>
        block.type === "tool_use"
          ? [{ id: block.id, name: block.name, input: JSON.stringify(block.input) }]
          : [],
      ),
      usage: {
        usageKnown: response.usage != null,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
  result(call: ToolCall, text: string) {
    const block: Anthropic.ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: call.id,
      content: text,
    };
    const previous = this.messages.at(-1);
    if (previous?.role === "user" && Array.isArray(previous.content)) previous.content.push(block);
    else this.messages.push({ role: "user", content: [block] });
  }
}
