import { describe, expect, it } from "vitest";
import { createApiClient } from "./index.js";

function clientAnswering(status: number, body?: unknown) {
  const requests: Request[] = [];
  const api = createApiClient("http://127.0.0.1:3100", {
    fetch: (request: Request) => {
      requests.push(request);
      return Promise.resolve(
        new Response(body === undefined ? null : JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  });
  return { api, requests };
}

describe("createApiClient", () => {
  it("calls the paths of the API with typed parameters and body", async () => {
    const { api, requests } = clientAnswering(201, {
      id: "0192f1c0-0000-7000-8000-000000000001",
      status: "running",
    });

    const { data } = await api.POST("/runs", {
      body: { graphVersionId: "0192f1c0-0000-7000-8000-000000000002", input: "comece" },
    });

    expect(requests[0]?.method).toBe("POST");
    expect(new URL(requests[0]!.url).pathname).toBe("/runs");
    expect(await requests[0]?.json()).toEqual({
      graphVersionId: "0192f1c0-0000-7000-8000-000000000002",
      input: "comece",
    });
    expect(data?.status).toBe("running");
  });

  it("fills path and query parameters", async () => {
    const { api, requests } = clientAnswering(200, { items: [] });

    await api.GET("/runs/{id}/events", {
      params: { path: { id: "abc" }, query: { fromSeq: 5, limit: 10 } },
    });

    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe("/runs/abc/events");
    expect(url.searchParams.get("fromSeq")).toBe("5");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("hands back the error shape of the API", async () => {
    const { api } = clientAnswering(404, {
      code: "graph_not_found",
      message: "Grafo não encontrado.",
    });

    const { data, error } = await api.GET("/graphs/{id}", {
      params: { path: { id: "0192f1c0-0000-7000-8000-00000000dead" } },
    });

    expect(data).toBeUndefined();
    expect(error?.code).toBe("graph_not_found");
  });

  it("writes a secret without any value coming back", async () => {
    const { api } = clientAnswering(204);

    const { response, error } = await api.PUT("/secrets/{name}", {
      params: { path: { name: "API_TOKEN" } },
      body: { value: "qualquer-valor" },
    });

    expect(response.status).toBe(204);
    expect(error).toBeUndefined();
  });
});
