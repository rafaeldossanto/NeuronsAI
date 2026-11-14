import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type {
  Effort,
  FunctionTool,
  ModelTurn,
  RespondOptions,
  ToolCall,
  TurnClient,
} from "./types.js";
import { supportedEffort } from "./capabilities.js";
import {
  guarded,
  safeDelta,
  StreamCutError,
  STREAM_IDLE_TIMEOUT_MS,
  type StreamGuard,
} from "./streaming.js";
/** What a reply may hold when the operator sets nothing (`NEURONS_MODEL_MAX_OUTPUT_TOKENS`). */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

type DeltaListener = NonNullable<RespondOptions["onDelta"]>;

export class OpenAITurnClient implements TurnClient {
  private readonly messages: OpenAI.Responses.ResponseInputItem[] = [];
  private readonly client: OpenAI;
  constructor(
    private readonly model: string,
    key: string,
    private readonly effort: Effort,
    fetcher?: typeof fetch,
    private readonly maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
    private readonly idleMs = STREAM_IDLE_TIMEOUT_MS,
  ) {
    // The SDK retries only what fails before the response starts (connection, 429, 5xx): once a
    // stream is open, and a delta may have reached the screen, a failure is the caller's to handle.
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
  async respond(
    briefing: string,
    tools: FunctionTool[],
    signal: AbortSignal,
    options: RespondOptions = {},
  ): Promise<ModelTurn> {
    const effort = supportedEffort("openai", this.model, this.effort);
    const params = {
      model: this.model,
      instructions: briefing,
      input: this.messages,
      store: false,
      // Without storage, reasoning items only round-trip when their encrypted content comes along.
      include: ["reasoning.encrypted_content" as const],
      max_output_tokens: this.maxOutputTokens,
      ...(effort && { reasoning: { effort } }),
      tools: tools.map((tool) => ({ type: "function" as const, ...tool, strict: false })),
    };
    const onDelta = options.onDelta && safeDelta(options.onDelta);
    const response = onDelta
      ? await guarded(signal, this.idleMs, (guard) => this.stream(params, guard, onDelta))
      : await this.client.responses.create(params, { signal });
    this.messages.push(...(response.output as OpenAI.Responses.ResponseInputItem[]));
    return {
      text: outputText(response),
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
  /** The final `Response` is the one the stream ends with: the same object a plain request returns. */
  private async stream(
    params: OpenAI.Responses.ResponseCreateParamsNonStreaming,
    guard: StreamGuard,
    onDelta: DeltaListener,
  ): Promise<OpenAI.Responses.Response> {
    const events = await this.client.responses.create(
      { ...params, stream: true },
      { signal: guard.signal },
    );
    const calls = new Map<string, { callId: string; name: string }>();
    let finished: OpenAI.Responses.Response | undefined;
    for await (const event of events) {
      guard.touch();
      switch (event.type) {
        case "response.output_text.delta":
          if (event.delta) onDelta({ type: "text", text: event.delta });
          break;
        case "response.output_item.added":
          if (event.item.type === "function_call" && event.item.id)
            calls.set(event.item.id, { callId: event.item.call_id, name: event.item.name });
          break;
        case "response.function_call_arguments.delta": {
          const call = calls.get(event.item_id);
          if (call && event.delta)
            onDelta({
              type: "toolArguments",
              callId: call.callId,
              tool: call.name,
              text: event.delta,
            });
          break;
        }
        case "response.completed":
        case "response.incomplete":
          finished = event.response;
          break;
        case "response.failed":
          throw new Error(event.response.error?.message ?? "O provedor não concluiu a resposta.");
        case "error":
          throw new Error(event.message || "O provedor interrompeu a resposta.");
        default:
          break;
      }
    }
    if (!finished) throw new StreamCutError();
    return finished;
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
    private readonly maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
    private readonly idleMs = STREAM_IDLE_TIMEOUT_MS,
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
  async respond(
    briefing: string,
    tools: FunctionTool[],
    signal: AbortSignal,
    options: RespondOptions = {},
  ): Promise<ModelTurn> {
    const effort = supportedEffort("anthropic", this.model, this.effort);
    const params = {
      model: this.model,
      max_tokens: this.maxOutputTokens,
      system: briefing,
      messages: this.messages,
      ...(effort && { output_config: { effort } }),
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: { ...tool.parameters, type: "object" as const },
      })),
    };
    const onDelta = options.onDelta && safeDelta(options.onDelta);
    const response = onDelta
      ? await guarded(signal, this.idleMs, (guard) => this.stream(params, guard, onDelta))
      : await this.client.messages.create(params, { signal });
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
  /** The SDK accumulates the events into the same `Message` a plain request returns. */
  private async stream(
    params: Anthropic.MessageCreateParamsNonStreaming,
    guard: StreamGuard,
    onDelta: DeltaListener,
  ): Promise<Anthropic.Message> {
    const stream = this.client.messages.stream(params, { signal: guard.signal });
    const blocks = new Map<number, { callId: string; name: string }>();
    let stopped = false;
    stream.on("streamEvent", (event) => {
      guard.touch();
      switch (event.type) {
        case "content_block_start":
          if (event.content_block.type === "tool_use")
            blocks.set(event.index, {
              callId: event.content_block.id,
              name: event.content_block.name,
            });
          break;
        case "content_block_delta":
          if (event.delta.type === "text_delta" && event.delta.text) {
            onDelta({ type: "text", text: event.delta.text });
          } else if (event.delta.type === "input_json_delta" && event.delta.partial_json) {
            const call = blocks.get(event.index);
            if (call)
              onDelta({
                type: "toolArguments",
                callId: call.callId,
                tool: call.name,
                text: event.delta.partial_json,
              });
          }
          break;
        case "message_stop":
          stopped = true;
          break;
        default:
          break;
      }
    });
    const message = await stream.finalMessage();
    if (!stopped) throw new StreamCutError();
    return message;
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

/** What `output_text` is on a plain request: the SDK adds it there, never to a streamed response. */
function outputText(response: OpenAI.Responses.Response): string {
  if (typeof response.output_text === "string") return response.output_text;
  return response.output
    .flatMap((item) => (item.type === "message" ? item.content : []))
    .flatMap((part) => (part.type === "output_text" ? [part.text] : []))
    .join("");
}
