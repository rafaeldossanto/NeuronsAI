import createClient, { type ClientOptions } from "openapi-fetch";
import type { paths } from "./schema.gen.js";

export type { components, operations, paths } from "./schema.gen.js";

/** The typed client of the NeuronsAI API: every path, parameter, body and response comes from the server's OpenAPI document. */
export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * @param baseUrl Where the server listens, e.g. `http://127.0.0.1:3100`.
 * @example
 *   const api = createApiClient("http://127.0.0.1:3100");
 *   const { data, error } = await api.GET("/graphs/{id}", { params: { path: { id } } });
 */
export function createApiClient(baseUrl: string, options: Omit<ClientOptions, "baseUrl"> = {}) {
  return createClient<paths>({ ...options, baseUrl });
}
