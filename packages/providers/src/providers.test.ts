import { describe, expect, it } from "vitest";
import { defaultProviders, ProviderRegistry, UsageCalculator, supportedEffort } from "./index.js";

describe("SDK adapters without paid calls", () => {
  it("keeps absent SDK usage unknown instead of reporting a zero cost", async () => {
    const fetcher: typeof fetch = () =>
      Promise.resolve(Response.json({ id: "no_usage", model: "gpt-4.1-mini", output: [] }));
    const client = defaultProviders({ fetcher }).createSession(
      "openai",
      "gpt-4.1-mini",
      "synthetic",
      "low",
    );
    const turn = await client.respond("test", [], AbortSignal.timeout(2000));
    expect(turn.usage.usageKnown).toBe(false);
    expect(new UsageCalculator().calculate("openai", "gpt-4.1-mini", turn.usage)).toBeUndefined();
  });
  it("round-trips Responses tool calls and omits reasoning for non-reasoning models", async () => {
    const requests: Record<string, unknown>[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      requests.push((await new Response(init?.body).json()) as Record<string, unknown>);
      return Response.json({
        id: "resp_test",
        model: "gpt-4.1-mini-2025-04-14",
        output: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "finish",
            arguments: '{"result":"ok"}',
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 10,
          input_tokens_details: { cached_tokens: 20 },
        },
      });
    };
    const client = defaultProviders({ fetcher }).createSession(
      "openai",
      "gpt-4.1-mini",
      "fake-key",
      "max",
    );
    client.addMessage("start");
    const first = await client.respond("briefing", [], AbortSignal.timeout(2000));
    expect(first.calls[0]).toMatchObject({ id: "call_1", name: "finish" });
    expect(first.usage).toMatchObject({ inputTokens: 100, cacheReadTokens: 20 });
    client.result(first.calls[0]!, "done");
    await client.respond("briefing", [], AbortSignal.timeout(2000));
    expect(requests[0]).not.toHaveProperty("reasoning");
    expect(requests[1]?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call_output",
          call_id: "call_1",
          output: "done",
        }),
      ]),
    );
  });
  it("normalizes Anthropic cache accounting and tool results", async () => {
    const requests: Record<string, unknown>[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      requests.push((await new Response(init?.body).json()) as Record<string, unknown>);
      return Response.json({
        id: "msg_test",
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "tool_use", id: "use_1", name: "finish", input: { result: "ok" } }],
        usage: {
          input_tokens: 100,
          output_tokens: 10,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 5,
        },
        stop_reason: "tool_use",
      });
    };
    const client = defaultProviders({ fetcher }).createSession(
      "anthropic",
      "claude-sonnet-4-5",
      "fake-key",
      "high",
    );
    client.addMessage("start");
    const first = await client.respond("briefing", [], AbortSignal.timeout(2000));
    expect(first.usage).toMatchObject({
      inputTokens: 100,
      cacheReadTokens: 20,
      cacheCreationTokens: 5,
    });
    client.result(first.calls[0]!, "done");
    await client.respond("briefing", [], AbortSignal.timeout(2000));
    expect(requests[0]).not.toHaveProperty("output_config");
    expect(requests[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: [expect.objectContaining({ type: "tool_result", tool_use_id: "use_1" })],
        }),
      ]),
    );
  });
  it("uses only the configured compatible endpoint and retains the tool call id", async () => {
    let endpoint = "";
    const fetcher: typeof fetch = async (url) => {
      endpoint = url instanceof Request ? url.url : url.toString();
      await Promise.resolve();
      return Response.json({
        id: "test",
        model: "local-model",
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                { type: "function", id: "local_1", function: { name: "finish", arguments: "{}" } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      });
    };
    const client = defaultProviders({
      compatibleBaseUrl: "http://127.0.0.1:11434/v1",
      fetcher,
    }).createSession("openai-compatible", "local-model", "local", "high");
    const turn = await client.respond("test", [], AbortSignal.timeout(2000));
    expect(endpoint).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(turn.calls[0]?.id).toBe("local_1");
    expect(() => new ProviderRegistry().createSession("missing", "test", "test", "low")).toThrow();
  });
});

it("calculates cache charges once and preserves unknown prices", () => {
  const calculator = new UsageCalculator();
  const usage = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 20, cacheCreationTokens: 0 };
  expect(calculator.calculate("openai", "gpt-4.1-mini-2025-04-14", usage)).toBeCloseTo(0.00005, 9);
  expect(
    calculator.calculate("anthropic", "claude-sonnet-4-5", { ...usage, cacheCreationTokens: 5 }),
  ).toBeCloseTo(0.00047475, 9);
  expect(calculator.calculate("openai", "unknown", usage)).toBeUndefined();
  expect(
    calculator.calculate("openai", "gpt-4.1-mini", { ...usage, usageKnown: false }),
  ).toBeUndefined();
  expect(
    calculator.calculate("openai", "gpt-4.1-mini", { ...usage, inputTokens: -1 }),
  ).toBeUndefined();
  expect(supportedEffort("openai", "gpt-4.1-mini", "max")).toBeUndefined();
  expect(supportedEffort("openai", "gpt-6.1-sol", "xhigh")).toBe("xhigh");
});
