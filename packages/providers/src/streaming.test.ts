import { describe, expect, it } from "vitest";
import {
  defaultProviders,
  StreamCutError,
  StreamStalledError,
  type ModelDelta,
  type TurnClient,
} from "./index.js";

const encoder = new TextEncoder();

interface SseEvent {
  event?: string;
  data: unknown;
}

/** How a simulated stream ends after its events. */
type Ending = "close" | "error" | "hang";

/** A Server-Sent Events response whose body ends as asked: cleanly, with a network error, or never. */
function sse(events: SseEvent[], ending: Ending = "close", signal?: AbortSignal | null): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const { event, data } of events) {
        const text = typeof data === "string" ? data : JSON.stringify(data);
        controller.enqueue(encoder.encode(`${event ? `event: ${event}\n` : ""}data: ${text}\n\n`));
      }
      if (ending === "close") controller.close();
      if (ending === "error") controller.error(new Error("connection reset"));
      // A real fetch ends the body when the request is aborted.
      signal?.addEventListener("abort", () => {
        try {
          controller.error(signal.reason);
        } catch {
          // already closed
        }
      });
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

const collect = () => {
  const deltas: ModelDelta[] = [];
  return { deltas, onDelta: (delta: ModelDelta) => void deltas.push(delta) };
};

const textOf = (deltas: ModelDelta[]) =>
  deltas.flatMap((delta) => (delta.type === "text" ? [delta.text] : [])).join("");
const argumentsOf = (deltas: ModelDelta[], callId: string) =>
  deltas
    .flatMap((delta) =>
      delta.type === "toolArguments" && delta.callId === callId ? [delta.text] : [],
    )
    .join("");

const asked = (client: TurnClient) => {
  client.addMessage("start");
  return client;
};

// ---- OpenAI Responses ----

const finalResponse = {
  id: "resp_1",
  model: "gpt-4.1-mini-2025-04-14",
  status: "completed",
  output: [
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Olá, mundo", annotations: [] }],
    },
    {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "send_message",
      arguments: '{"to":"b","text":"oi"}',
      status: "completed",
    },
  ],
  usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 20 } },
};

const responsesEvents: SseEvent[] = [
  { event: "response.created", data: { type: "response.created", response: finalResponse } },
  {
    event: "response.output_text.delta",
    data: { type: "response.output_text.delta", item_id: "msg_1", delta: "Olá, " },
  },
  {
    event: "response.output_text.delta",
    data: { type: "response.output_text.delta", item_id: "msg_1", delta: "mundo" },
  },
  {
    event: "response.output_item.added",
    data: {
      type: "response.output_item.added",
      output_index: 1,
      item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "send_message" },
    },
  },
  {
    event: "response.function_call_arguments.delta",
    data: {
      type: "response.function_call_arguments.delta",
      item_id: "fc_1",
      delta: '{"to":"b","te',
    },
  },
  {
    event: "response.function_call_arguments.delta",
    data: { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: 'xt":"oi"}' },
  },
  { event: "response.completed", data: { type: "response.completed", response: finalResponse } },
];

describe("OpenAI Responses streamed", () => {
  const client = (fetcher: typeof fetch, idleMs?: number) =>
    asked(
      defaultProviders({
        fetcher,
        ...(idleMs !== undefined && { streamIdleTimeoutMs: idleMs }),
      }).createSession("openai", "gpt-4.1-mini", "fake-key", "low"),
    );

  it("tells the text and the tool arguments as they come, and ends with the plain turn", async () => {
    const bodies: Record<string, unknown>[] = [];
    const streamed = client(async (_url, init) => {
      bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
      await Promise.resolve();
      return sse(responsesEvents);
    });
    const { deltas, onDelta } = collect();
    const turn = await streamed.respond("briefing", [], AbortSignal.timeout(5000), { onDelta });

    expect(bodies[0]).toMatchObject({ stream: true, store: false });
    expect(deltas[0]).toEqual({ type: "text", text: "Olá, " });
    expect(textOf(deltas)).toBe("Olá, mundo");
    expect(argumentsOf(deltas, "call_1")).toBe('{"to":"b","text":"oi"}');
    expect(deltas.find((d) => d.type === "toolArguments")).toMatchObject({ tool: "send_message" });

    // The turn a plain request returns for the same final response.
    const plain = await client(() => Promise.resolve(Response.json(finalResponse))).respond(
      "briefing",
      [],
      AbortSignal.timeout(5000),
    );
    expect(turn).toEqual(plain);
    expect(turn).toMatchObject({
      text: "Olá, mundo",
      calls: [{ id: "call_1", name: "send_message", input: '{"to":"b","text":"oi"}' }],
      usage: { usageKnown: true, inputTokens: 100, outputTokens: 10, cacheReadTokens: 20 },
    });
  });

  it("keeps the conversation: the next request carries the streamed output and the result", async () => {
    const bodies: { input: unknown[] }[] = [];
    const streamed = client(async (_url, init) => {
      bodies.push(JSON.parse(init?.body as string) as { input: unknown[] });
      await Promise.resolve();
      return sse(responsesEvents);
    });
    const first = await streamed.respond("b", [], AbortSignal.timeout(5000), {
      onDelta: () => undefined,
    });
    streamed.result(first.calls[0]!, "feito");
    await streamed.respond("b", [], AbortSignal.timeout(5000), { onDelta: () => undefined });
    expect(bodies[1]?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "function_call", call_id: "call_1" }),
        expect.objectContaining({
          type: "function_call_output",
          call_id: "call_1",
          output: "feito",
        }),
      ]),
    );
  });

  it("rejects a stream that ends without the final event, after telling what arrived", async () => {
    const cut = client(() => Promise.resolve(sse(responsesEvents.slice(0, 3))));
    const { deltas, onDelta } = collect();
    await expect(
      cut.respond("b", [], AbortSignal.timeout(5000), { onDelta }),
    ).rejects.toBeInstanceOf(StreamCutError);
    expect(textOf(deltas)).toBe("Olá, mundo");
  });

  it("rejects when the connection breaks in the middle", async () => {
    const broken = client(() => Promise.resolve(sse(responsesEvents.slice(0, 3), "error")));
    await expect(
      broken.respond("b", [], AbortSignal.timeout(5000), { onDelta: () => undefined }),
    ).rejects.toThrow();
  });

  it("rejects a response the provider reports as failed", async () => {
    const failed = client(() =>
      Promise.resolve(
        sse([
          {
            event: "response.failed",
            data: {
              type: "response.failed",
              response: { ...finalResponse, status: "failed", error: { message: "sem cota" } },
            },
          },
        ]),
      ),
    );
    await expect(
      failed.respond("b", [], AbortSignal.timeout(5000), { onDelta: () => undefined }),
    ).rejects.toThrow("sem cota");
  });

  it("stops at once when the signal aborts while the stream is open", async () => {
    const hanging = client((_url, init) =>
      Promise.resolve(sse(responsesEvents.slice(0, 2), "hang", init?.signal)),
    );
    const controller = new AbortController();
    const { onDelta } = collect();
    const pending = hanging.respond("b", [], controller.signal, {
      onDelta: (delta) => {
        onDelta(delta);
        controller.abort();
      },
    });
    await expect(pending).rejects.toThrow();
    expect(controller.signal.aborted).toBe(true);
  });

  it("gives up on a stream that goes quiet", async () => {
    const quiet = client(
      (_url, init) => Promise.resolve(sse(responsesEvents.slice(0, 2), "hang", init?.signal)),
      60,
    );
    await expect(
      quiet.respond("b", [], AbortSignal.timeout(5000), { onDelta: () => undefined }),
    ).rejects.toBeInstanceOf(StreamStalledError);
  });

  it("retries a request that failed before the stream began, and tells only the second attempt", async () => {
    let attempts = 0;
    const retried = client(() => {
      attempts++;
      return Promise.resolve(
        attempts === 1
          ? new Response("{}", { status: 500, headers: { "retry-after-ms": "1" } })
          : sse(responsesEvents),
      );
    });
    const { deltas, onDelta } = collect();
    const turn = await retried.respond("b", [], AbortSignal.timeout(5000), { onDelta });
    expect(attempts).toBe(2);
    expect(textOf(deltas)).toBe("Olá, mundo");
    expect(turn.calls).toHaveLength(1);
  });

  it("does not repeat a request whose stream broke after the first delta", async () => {
    let attempts = 0;
    const broken = client(() => {
      attempts++;
      return Promise.resolve(sse(responsesEvents.slice(0, 3), "error"));
    });
    await expect(
      broken.respond("b", [], AbortSignal.timeout(5000), { onDelta: () => undefined }),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it("does not let a failing listener end the turn", async () => {
    const streamed = client(() => Promise.resolve(sse(responsesEvents)));
    const turn = await streamed.respond("b", [], AbortSignal.timeout(5000), {
      onDelta: () => {
        throw new Error("tela fechada");
      },
    });
    expect(turn.calls).toHaveLength(1);
  });
});

// ---- Anthropic Messages ----

const usageStart = {
  input_tokens: 100,
  output_tokens: 1,
  cache_read_input_tokens: 20,
  cache_creation_input_tokens: 5,
};

const messagesEvents: SseEvent[] = [
  {
    event: "message_start",
    data: {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [],
        stop_reason: null,
        usage: usageStart,
      },
    },
  },
  {
    event: "content_block_start",
    data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  },
  {
    event: "content_block_delta",
    data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Olá, " } },
  },
  {
    event: "content_block_delta",
    data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "mundo" } },
  },
  { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
  {
    event: "content_block_start",
    data: {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "use_1", name: "send_message", input: {} },
    },
  },
  {
    event: "content_block_delta",
    data: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"to":"b","te' },
    },
  },
  {
    event: "content_block_delta",
    data: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: 'xt":"oi"}' },
    },
  },
  { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
  {
    event: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 10 },
    },
  },
  { event: "message_stop", data: { type: "message_stop" } },
];

describe("Anthropic Messages streamed", () => {
  const client = (fetcher: typeof fetch, idleMs?: number) =>
    asked(
      defaultProviders({
        fetcher,
        ...(idleMs !== undefined && { streamIdleTimeoutMs: idleMs }),
      }).createSession("anthropic", "claude-sonnet-4-5", "fake-key", "high"),
    );

  it("tells the text and the tool arguments as they come, with the same turn and usage", async () => {
    const bodies: Record<string, unknown>[] = [];
    const streamed = client(async (_url, init) => {
      bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
      await Promise.resolve();
      return sse(messagesEvents);
    });
    const { deltas, onDelta } = collect();
    const turn = await streamed.respond("briefing", [], AbortSignal.timeout(5000), { onDelta });

    expect(bodies[0]).toMatchObject({ stream: true });
    expect(textOf(deltas)).toBe("Olá, mundo");
    expect(argumentsOf(deltas, "use_1")).toBe('{"to":"b","text":"oi"}');
    expect(deltas.find((d) => d.type === "toolArguments")).toMatchObject({ tool: "send_message" });
    expect(turn).toEqual({
      text: "Olá, mundo",
      calls: [{ id: "use_1", name: "send_message", input: '{"to":"b","text":"oi"}' }],
      usage: {
        usageKnown: true,
        model: "claude-sonnet-4-5",
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 20,
        cacheCreationTokens: 5,
      },
    });

    streamed.result(turn.calls[0]!, "feito");
    await streamed.respond("briefing", [], AbortSignal.timeout(5000), { onDelta: () => undefined });
    expect(
      (bodies[1] as { messages: { role: string; content: unknown }[] }).messages.slice(1),
    ).toEqual([
      {
        role: "assistant",
        content: [
          expect.objectContaining({ type: "text", text: "Olá, mundo" }),
          expect.objectContaining({
            type: "tool_use",
            id: "use_1",
            input: { to: "b", text: "oi" },
          }),
        ],
      },
      {
        role: "user",
        content: [expect.objectContaining({ type: "tool_result", tool_use_id: "use_1" })],
      },
    ]);
  });

  it("rejects a stream cut before message_stop, and one whose connection breaks", async () => {
    const cut = client(() => Promise.resolve(sse(messagesEvents.slice(0, 4))));
    const { deltas, onDelta } = collect();
    await expect(cut.respond("b", [], AbortSignal.timeout(5000), { onDelta })).rejects.toThrow();
    expect(textOf(deltas)).toBe("Olá, mundo");

    const broken = client(() => Promise.resolve(sse(messagesEvents.slice(0, 4), "error")));
    await expect(
      broken.respond("b", [], AbortSignal.timeout(5000), { onDelta: () => undefined }),
    ).rejects.toThrow();
  });

  it("rejects an error event the provider sends in the middle of the stream", async () => {
    const overloaded = client(() =>
      Promise.resolve(
        sse([
          ...messagesEvents.slice(0, 3),
          {
            event: "error",
            data: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
          },
        ]),
      ),
    );
    await expect(
      overloaded.respond("b", [], AbortSignal.timeout(5000), { onDelta: () => undefined }),
    ).rejects.toThrow();
  });

  it("stops at once when the signal aborts, and gives up on a stream that goes quiet", async () => {
    const controller = new AbortController();
    const hanging = client((_url, init) =>
      Promise.resolve(sse(messagesEvents.slice(0, 3), "hang", init?.signal)),
    );
    await expect(
      hanging.respond("b", [], controller.signal, {
        onDelta: () => controller.abort(),
      }),
    ).rejects.toThrow();

    const quiet = client(
      (_url, init) => Promise.resolve(sse(messagesEvents.slice(0, 3), "hang", init?.signal)),
      60,
    );
    await expect(
      quiet.respond("b", [], AbortSignal.timeout(5000), { onDelta: () => undefined }),
    ).rejects.toBeInstanceOf(StreamStalledError);
  });

  it("retries a request that failed before the stream began", async () => {
    let attempts = 0;
    const retried = client(() => {
      attempts++;
      return Promise.resolve(
        attempts === 1
          ? new Response("{}", { status: 529, headers: { "retry-after-ms": "1" } })
          : sse(messagesEvents),
      );
    });
    const { deltas, onDelta } = collect();
    await retried.respond("b", [], AbortSignal.timeout(5000), { onDelta });
    expect(attempts).toBe(2);
    expect(textOf(deltas)).toBe("Olá, mundo");
  });
});

// ---- OpenAI-compatible (Chat Completions) ----

const chunk = (delta: Record<string, unknown>, finish: string | null = null, extra = {}) => ({
  data: {
    id: "c1",
    object: "chat.completion.chunk",
    model: "local-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...extra,
  },
});

const chatEvents: SseEvent[] = [
  chunk({ role: "assistant", content: "Olá, " }),
  chunk({ content: "mundo" }),
  chunk({
    tool_calls: [
      {
        index: 0,
        id: "local_1",
        type: "function",
        function: { name: "reply", arguments: '{"messageId":"m1",' },
      },
    ],
  }),
  chunk({ tool_calls: [{ index: 0, function: { arguments: '"text":"oi"}' } }] }),
  chunk({}, "tool_calls"),
  {
    data: {
      id: "c1",
      object: "chat.completion.chunk",
      model: "local-model",
      choices: [],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 3,
        prompt_tokens_details: { cached_tokens: 4 },
      },
    },
  },
  { data: "[DONE]" },
];

describe("OpenAI-compatible streamed", () => {
  const client = (fetcher: typeof fetch, idleMs?: number) =>
    asked(
      defaultProviders({
        compatibleBaseUrl: "http://127.0.0.1:11434/v1",
        fetcher,
        ...(idleMs !== undefined && { streamIdleTimeoutMs: idleMs }),
      }).createSession("openai-compatible", "local-model", "local", "high"),
    );

  it("tells the text and the tool arguments as they come, and sends back the plain fields only", async () => {
    const bodies: { messages: Record<string, unknown>[]; stream?: boolean }[] = [];
    const streamed = client(async (_url, init) => {
      bodies.push(JSON.parse(init?.body as string) as (typeof bodies)[number]);
      await Promise.resolve();
      return sse(chatEvents);
    });
    const { deltas, onDelta } = collect();
    const turn = await streamed.respond("briefing", [], AbortSignal.timeout(5000), { onDelta });

    expect(bodies[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(textOf(deltas)).toBe("Olá, mundo");
    expect(argumentsOf(deltas, "local_1")).toBe('{"messageId":"m1","text":"oi"}');
    expect(turn).toEqual({
      text: "Olá, mundo",
      calls: [{ id: "local_1", name: "reply", input: '{"messageId":"m1","text":"oi"}' }],
      usage: {
        usageKnown: true,
        model: "local-model",
        inputTokens: 12,
        outputTokens: 3,
        cacheReadTokens: 4,
        cacheCreationTokens: 0,
      },
    });

    streamed.result(turn.calls[0]!, "ok");
    await streamed.respond("briefing", [], AbortSignal.timeout(5000), { onDelta: () => undefined });
    expect(bodies[1]!.messages.at(-2)).toEqual({
      role: "assistant",
      content: "Olá, mundo",
      tool_calls: [
        {
          id: "local_1",
          type: "function",
          function: { name: "reply", arguments: '{"messageId":"m1","text":"oi"}' },
        },
      ],
    });
  });

  it("rejects a stream that ends before the finish reason, and one that breaks", async () => {
    const cut = client(() => Promise.resolve(sse(chatEvents.slice(0, 2))));
    const { deltas, onDelta } = collect();
    await expect(
      cut.respond("b", [], AbortSignal.timeout(5000), { onDelta }),
    ).rejects.toBeInstanceOf(StreamCutError);
    expect(textOf(deltas)).toBe("Olá, mundo");

    const broken = client(() => Promise.resolve(sse(chatEvents.slice(0, 2), "error")));
    await expect(
      broken.respond("b", [], AbortSignal.timeout(5000), { onDelta: () => undefined }),
    ).rejects.toThrow();
  });

  it("stops at once when the signal aborts, and gives up on a stream that goes quiet", async () => {
    const controller = new AbortController();
    const hanging = client((_url, init) =>
      Promise.resolve(sse(chatEvents.slice(0, 2), "hang", init?.signal)),
    );
    await expect(
      hanging.respond("b", [], controller.signal, { onDelta: () => controller.abort() }),
    ).rejects.toThrow();

    const quiet = client(
      (_url, init) => Promise.resolve(sse(chatEvents.slice(0, 2), "hang", init?.signal)),
      60,
    );
    await expect(
      quiet.respond("b", [], AbortSignal.timeout(5000), { onDelta: () => undefined }),
    ).rejects.toBeInstanceOf(StreamStalledError);
  });

  it("retries a request that failed before the stream began", async () => {
    let attempts = 0;
    const retried = client(() => {
      attempts++;
      return Promise.resolve(
        attempts === 1
          ? new Response("{}", { status: 503, headers: { "retry-after-ms": "1" } })
          : sse(chatEvents),
      );
    });
    await retried.respond("b", [], AbortSignal.timeout(5000), { onDelta: () => undefined });
    expect(attempts).toBe(2);
  });

  it("falls back to a plain request when the server refuses to stream, and remembers it", async () => {
    const seen: boolean[] = [];
    const plain = {
      id: "c",
      model: "local-model",
      choices: [{ message: { role: "assistant", content: "oi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const picky = client(async (_url, init) => {
      const body = JSON.parse(init?.body as string) as { stream?: boolean };
      seen.push(body.stream === true);
      await Promise.resolve();
      return body.stream
        ? new Response(JSON.stringify({ error: { message: "stream não suportado" } }), {
            status: 400,
            headers: { "content-type": "application/json" },
          })
        : Response.json(plain);
    });
    const { deltas, onDelta } = collect();
    const first = await picky.respond("b", [], AbortSignal.timeout(5000), { onDelta });
    expect(first.text).toBe("oi");
    expect(deltas).toEqual([]);
    await picky.respond("b", [], AbortSignal.timeout(5000), { onDelta });
    expect(seen).toEqual([true, false, false]);
  });
});
