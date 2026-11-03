import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { App, createQueryClient } from "@/app";
import { createApi } from "@/lib/api";

type Json = { status?: number; body?: unknown };
/** A reply is a JSON answer or a function that fails the request (a network error). */
type Reply = Json | (() => Promise<never>);
type Routes = Record<string, Json | ((request: Request) => Reply)>;

/** A `fetch` double: routes are keyed `"METHOD /path"`; anything else answers 500 so a missing route is loud. */
export function mockFetch(routes: Routes) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: Request) => {
    const url = new URL(input.url);
    const key = `${input.method} ${url.pathname.replace(/^\/api/, "")}`;
    const text = await input.clone().text();
    calls.push({
      method: input.method,
      path: key,
      body: text ? (JSON.parse(text) as unknown) : null,
    });
    const route = routes[key];
    if (!route) return Response.json({ code: "no_route", message: key }, { status: 500 });
    const reply: Reply = typeof route === "function" ? route(input) : route;
    if (typeof reply === "function") return reply();
    return Response.json(reply.body ?? null, { status: reply.status ?? 200 });
  });
  return { fetch: fetchMock as unknown as typeof fetch, calls };
}

export function renderApp(path: string, routes: Routes) {
  const { fetch, calls } = mockFetch(routes);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App api={createApi(fetch)} queryClient={createQueryClient()} />
    </MemoryRouter>,
  );
  return { ...view, calls };
}

export const graphId = "6f1d8a52-4b0e-4c53-9d0a-2b1f5f0c1a11";
export const runId = "0b5c7f1e-3a42-4d6b-8e21-9c4d7a6b5e30";

export const graphSummary = {
  id: graphId,
  name: "Revisão de código",
  createdAt: "2026-11-02T10:00:00.000Z",
  updatedAt: "2026-11-02T11:30:00.000Z",
};

export const graph = {
  ...graphSummary,
  draft: { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], links: [{ id: "l1" }] },
  latestVersion: 2,
};

export const runSummary = {
  id: runId,
  graphId,
  graphVersionId: "5d2a9e84-7c1b-4f30-a6e5-1d8b3c9f2a47",
  status: "running" as const,
  budgetUsd: null,
  startedAt: "2026-11-02T12:00:00.000Z",
  finishedAt: null,
};

export const runDetail = {
  ...runSummary,
  input: "Revise o PR 42",
  finish: null,
  usage: {
    total: { costUsd: 0.0123, turns: 3, unknownCostTurns: 0 },
    byAgent: { revisor: { costUsd: 0.0123, turns: 3, unknownCostTurns: 0 } },
  },
};
