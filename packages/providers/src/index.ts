import { OpenAITurnClient, AnthropicTurnClient } from "./sdk-clients.js";
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
    if (!found) throw new Error("Unsupported provider");
    return found.createSession(model, key, effort);
  }
}
export function defaultProviders(
  options: {
    compatibleBaseUrl?: string;
    fetcher?: typeof fetch;
    compatibleFetch?: typeof fetch;
  } = {},
): ProviderRegistry {
  const registry = new ProviderRegistry()
    .register({
      name: "openai",
      createSession: (model, key, effort) =>
        new OpenAITurnClient(model, key, effort, options.fetcher),
    })
    .register({
      name: "anthropic",
      createSession: (model, key, effort) =>
        new AnthropicTurnClient(model, key, effort, options.fetcher),
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
