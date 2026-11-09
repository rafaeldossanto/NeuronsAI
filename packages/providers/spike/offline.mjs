// Contract comparison only. Every SDK request is intercepted; this script cannot make paid calls.
import { defaultProviders, UsageCalculator, PRICE_VERSION } from "../dist/index.js";
const rows = [];
for (const provider of ["openai", "anthropic", "openai-compatible"]) {
  const model =
    provider === "anthropic"
      ? "claude-sonnet-4-5"
      : provider === "openai"
        ? "gpt-4.1-mini"
        : "local-model";
  let requested = false;
  const fetcher = async (_url, init) => {
    requested = true;
    const body = JSON.parse(init.body);
    if (!body.tools?.length) throw Error("Missing tool declaration");
    const usage = { input_tokens: 100, output_tokens: 10 };
    return Response.json(
      provider === "anthropic"
        ? {
            id: "mock",
            role: "assistant",
            model,
            content: [{ type: "tool_use", id: "call", name: "finish", input: { result: "ok" } }],
            stop_reason: "tool_use",
            usage,
          }
        : provider === "openai"
          ? {
              id: "mock",
              model,
              output: [
                {
                  type: "function_call",
                  call_id: "call",
                  name: "finish",
                  arguments: '{"result":"ok"}',
                },
              ],
              usage,
            }
          : {
              id: "mock",
              model,
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "call",
                        type: "function",
                        function: { name: "finish", arguments: '{"result":"ok"}' },
                      },
                    ],
                  },
                },
              ],
              usage: { prompt_tokens: 100, completion_tokens: 10 },
            },
    );
  };
  const session = defaultProviders({
    fetcher,
    compatibleBaseUrl: "http://offline.invalid/v1",
  }).createSession(provider, model, "synthetic-key", "high");
  session.addMessage("Conclua usando finish com result igual a ok.");
  const response = await session.respond(
    "Teste de contrato.",
    [
      {
        name: "finish",
        description: "Conclui.",
        parameters: {
          type: "object",
          properties: { result: { type: "string" } },
          required: ["result"],
        },
      },
    ],
    AbortSignal.timeout(5000),
  );
  if (!requested || response.calls[0]?.name !== "finish")
    throw Error("Invalid tool-call round trip");
  session.result(response.calls[0], "ok");
  rows.push({
    provider,
    mode: "simulado, sem rede",
    tool: response.calls[0].name,
    tokens: response.usage.inputTokens + response.usage.outputTokens,
    estimatedUsd: new UsageCalculator().calculate(provider, model, response.usage) ?? null,
  });
}
console.log(
  JSON.stringify({ priceVersion: PRICE_VERSION, realProviderAcceptance: false, rows }, null, 2),
);
