import OpenAI from "openai";
import type {
  TurnClient,
  FunctionTool,
  ModelTurn,
  ModelUsage,
  RespondOptions,
  ToolCall,
} from "./types.js";
import {
  guarded,
  safeDelta,
  StreamCutError,
  STREAM_IDLE_TIMEOUT_MS,
  type StreamGuard,
} from "./streaming.js";

type Completion = OpenAI.Chat.Completions.ChatCompletion;
type ToolCallPart = OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall;

/** The statuses of a server that does not do `stream: true` (or `stream_options`) at all. */
const NO_STREAMING_STATUSES: readonly number[] = [400, 404, 405, 415, 422, 501];

interface OpenCall {
  id: string;
  name: string;
  arguments: string;
}

/** What a reply is once it is whole, however it arrived. */
interface Reply {
  content: string | null;
  calls: { id: string; name: string; arguments: string }[];
  usage: ModelUsage;
}

/** Base URL is operator configuration, never supplied by a graph. */
export class OpenAICompatibleTurnClient implements TurnClient {
  private messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  private client: OpenAI;
  /** Cleared when the server refuses a streamed request: it keeps working, without the live text. */
  private streamingWorks = true;
  constructor(
    private model: string,
    key: string,
    baseURL: string,
    fetcher?: typeof fetch,
    private idleMs = STREAM_IDLE_TIMEOUT_MS,
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
  async respond(
    briefing: string,
    tools: FunctionTool[],
    signal: AbortSignal,
    options: RespondOptions = {},
  ): Promise<ModelTurn> {
    const params = {
      model: this.model,
      messages: [{ role: "system" as const, content: briefing }, ...this.messages],
      tools: tools.map((tool) => ({ type: "function" as const, function: tool })),
    };
    const onDelta = options.onDelta && safeDelta(options.onDelta);
    const reply =
      onDelta && this.streamingWorks
        ? await this.streamedReply(params, signal, onDelta)
        : toReply(await this.client.chat.completions.create(params, { signal }));

    // Only the fields of the Chat Completions contract go back: compatible servers add their own
    // (`reasoning_content`, `refusal`, `annotations`...) and some reject a request that echoes them.
    this.messages.push({
      role: "assistant",
      content: reply.content ?? null,
      ...(reply.calls.length > 0 && {
        tool_calls: reply.calls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      }),
    });
    return {
      text: reply.content ?? "",
      calls: reply.calls.map((call) => ({
        id: call.id,
        name: call.name,
        input: call.arguments,
      })),
      usage: reply.usage,
    };
  }

  private async streamedReply(
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    signal: AbortSignal,
    onDelta: NonNullable<RespondOptions["onDelta"]>,
  ): Promise<Reply> {
    let started = false;
    try {
      return await guarded(signal, this.idleMs, (guard) =>
        this.stream(params, guard, (delta) => {
          started = true;
          onDelta(delta);
        }),
      );
    } catch (error) {
      // A refusal of the request itself comes before anything was written; anything else is final.
      if (
        !started &&
        !signal.aborted &&
        error instanceof OpenAI.APIError &&
        NO_STREAMING_STATUSES.includes(Number(error.status))
      ) {
        this.streamingWorks = false;
        return toReply(await this.client.chat.completions.create(params, { signal }));
      }
      throw error;
    }
  }

  private async stream(
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    guard: StreamGuard,
    onDelta: NonNullable<RespondOptions["onDelta"]>,
  ): Promise<Reply> {
    const chunks = await this.client.chat.completions.create(
      { ...params, stream: true, stream_options: { include_usage: true } },
      { signal: guard.signal },
    );
    let content = "";
    let model: string | undefined;
    let finished = false;
    let usage: OpenAI.CompletionUsage | null | undefined;
    const calls = new Map<number, OpenCall>();
    for await (const chunk of chunks) {
      guard.touch();
      model = chunk.model || model;
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices[0];
      if (!choice) continue;
      if (choice.finish_reason) finished = true;
      const text = choice.delta.content;
      if (text) {
        content += text;
        onDelta({ type: "text", text });
      }
      for (const part of choice.delta.tool_calls ?? []) {
        const call = openCall(calls, part);
        const fragment = part.function?.arguments;
        if (fragment) {
          call.arguments += fragment;
          if (call.id && call.name)
            onDelta({ type: "toolArguments", callId: call.id, tool: call.name, text: fragment });
        }
      }
    }
    if (!finished) throw new StreamCutError();
    return {
      content: content || null,
      calls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call),
      usage: toUsage(model, usage),
    };
  }

  result(call: ToolCall, text: string) {
    this.messages.push({ role: "tool", tool_call_id: call.id, content: text });
  }
}

/** The pieces of one tool call arrive spread over chunks, tied together by `index`. */
function openCall(calls: Map<number, OpenCall>, part: ToolCallPart): OpenCall {
  let call = calls.get(part.index);
  if (!call) {
    call = { id: "", name: "", arguments: "" };
    calls.set(part.index, call);
  }
  if (part.id) call.id = part.id;
  if (part.function?.name) call.name = part.function.name;
  return call;
}

function toReply(response: Completion): Reply {
  const message = response.choices[0]?.message;
  if (!message) throw new Error("Empty model response");
  return {
    content: message.content ?? null,
    calls: (message.tool_calls ?? []).flatMap((call) =>
      call.type === "function"
        ? [{ id: call.id, name: call.function.name, arguments: call.function.arguments }]
        : [],
    ),
    usage: toUsage(response.model, response.usage),
  };
}

function toUsage(model: string | undefined, usage: OpenAI.CompletionUsage | null | undefined) {
  return {
    usageKnown: usage != null,
    ...(model !== undefined && { model }),
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheCreationTokens: 0,
  } satisfies ModelUsage;
}
