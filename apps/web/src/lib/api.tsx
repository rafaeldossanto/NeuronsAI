import { createApiClient, type ApiClient } from "@neurons/api-client";
import { createContext, useContext, type ReactNode } from "react";
import { apiBaseUrl } from "@/config";

/** An API failure carrying the server's stable `code` (the UI decides by it) and its pt-BR `message`. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createApi(fetchImpl?: typeof fetch): ApiClient {
  return createApiClient(apiBaseUrl, fetchImpl ? { fetch: fetchImpl } : {});
}

/** Turns an openapi-fetch result into its data, or throws an `ApiError` (also when the server is unreachable). */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result;
  try {
    result = await call;
  } catch {
    throw new ApiError("network_error", "Não foi possível falar com o servidor.");
  }
  if (result.error !== undefined || result.data === undefined) {
    const body = result.error as { code?: string; message?: string } | undefined;
    throw new ApiError(
      body?.code ?? "unexpected_response",
      body?.message ?? "O servidor respondeu algo inesperado.",
      result.response.status,
    );
  }
  return result.data;
}

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi fora do ApiProvider");
  return api;
}
