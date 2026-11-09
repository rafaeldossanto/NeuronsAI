import { defaultProviders, type ProviderRegistry } from "@neurons/providers";
import { createGuardedFetch } from "@neurons/tools";
import type { AppConfig } from "../shared/config/app-config.js";

/**
 * The model providers an API agent can use. The `openai-compatible` endpoint is operator
 * configuration (never part of a graph); on public profiles its requests go through the same
 * outbound guard as the HTTP tools, so it cannot be pointed at an internal network.
 */
export function modelProviders(config: AppConfig): ProviderRegistry {
  const outbound = config.outbound;
  return defaultProviders({
    ...(config.compatibleBaseUrl && { compatibleBaseUrl: config.compatibleBaseUrl }),
    ...(outbound && {
      compatibleFetch: (input: Request | string | URL, init?: RequestInit) =>
        createGuardedFetch(outbound)(input instanceof Request ? input.url : input.toString(), init),
    }),
  });
}
