import { OpenAITurnClient, AnthropicTurnClient } from "./sdk-clients.js";
export { DEFAULT_MAX_OUTPUT_TOKENS } from "./sdk-clients.js";
import { OpenAICompatibleTurnClient } from "./compatible.js";
import type { Effort, ModelProvider, TurnClient, ModelEvent, FunctionTool } from "./types.js";
export * from "./types.js";
export * from "./pricing.js";
export * from "./capabilities.js";
export { OpenAITurnClient, AnthropicTurnClient, OpenAICompatibleTurnClient };
export class ProviderRegistry {
  private providers = new Map<string, ModelProvider>();
  register(provider: ModelProvider): this {
    if (this.providers.has(provider.name)) throw new Error("Duplicate provider");
    this.providers.set(provider.name, provider);
    return this;
  }
  createSession(provider: string, model: string, key: string, effort: Effort): TurnClient {
    const found = this.providers.get(provider);
    if (!found && provider === "openai-compatible")
      throw new Error(
        "O provedor openai-compatible não está configurado neste servidor: defina NEURONS_OPENAI_COMPATIBLE_BASE_URL com o endereço do servidor compatível (por exemplo http://127.0.0.1:11434/v1) e reinicie.",
      );
    if (!found) throw new Error("Unsupported provider");
    return found.createSession(model, key, effort);
  }
}
export function defaultProviders(
  options: {
    compatibleBaseUrl?: string;
    fetcher?: typeof fetch;
    compatibleFetch?: typeof fetch;
    /** Cap on one reply of the OpenAI and Anthropic adapters; raise it for reasoning models. */
    maxOutputTokens?: number;
  } = {},
): ProviderRegistry {
  const registry = new ProviderRegistry()
    .register({
      name: "openai",
      createSession: (model, key, effort) =>
        new OpenAITurnClient(model, key, effort, options.fetcher, options.maxOutputTokens),
    })
    .register({
      name: "anthropic",
      createSession: (model, key, effort) =>
        new AnthropicTurnClient(model, key, effort, options.fetcher, options.maxOutputTokens),
    });
  if (options.compatibleBaseUrl)
    registry.register({
      name: "openai-compatible",
      createSession: (model, key) =>
        new OpenAICompatibleTurnClient(
          model,
          key,
          options.compatibleBaseUrl!,
          options.compatibleFetch ?? options.fetcher,
        ),
    });
  return registry;
}
/** Normalized turn events; transport-specific SDK objects never escape the package. */
export async function* runModelTurn(
  client: TurnClient,
  briefing: string,
  tools: FunctionTool[],
  signal: AbortSignal,
): AsyncIterable<ModelEvent> {
  const turn = await client.respond(briefing, tools, signal);
  if (turn.text) yield { type: "text", text: turn.text };
  yield { type: "usage", usage: turn.usage };
  for (const call of turn.calls) yield { type: "toolCall", call };
  yield { type: "done" };
}
