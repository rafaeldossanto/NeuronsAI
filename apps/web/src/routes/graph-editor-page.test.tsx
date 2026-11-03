import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { graph, graphId, renderApp } from "@/test/helpers";

const version = {
  id: "5d2a9e84-7c1b-4f30-a6e5-1d8b3c9f2a47",
  graphId,
  version: 2,
  createdAt: "2026-11-02T11:00:00.000Z",
};

describe("editor", () => {
  it("mostra os dados, o rascunho, as versões e a área reservada do canvas", async () => {
    renderApp(`/graphs/${graphId}`, {
      [`GET /graphs/${graphId}`]: { body: graph },
      [`GET /graphs/${graphId}/versions`]: { body: { items: [version] } },
    });

    expect(screen.getByRole("status", { name: "Carregando grafo" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Revisão de código" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Área do canvas" })).toBeInTheDocument();
    expect(await screen.findByText("v2")).toBeInTheDocument();
    expect(screen.getByText("Blocos").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Setas").nextSibling).toHaveTextContent("1");
  });

  it("explica quando não há rascunho nem versões", async () => {
    renderApp(`/graphs/${graphId}`, {
      [`GET /graphs/${graphId}`]: { body: { ...graph, draft: null, latestVersion: null } },
      [`GET /graphs/${graphId}/versions`]: { body: { items: [] } },
    });

    expect(await screen.findByText("Ainda não há rascunho salvo.")).toBeInTheDocument();
    expect(await screen.findByText("Nenhuma versão publicada")).toBeInTheDocument();
  });

  it("mostra o erro quando o grafo não existe", async () => {
    renderApp(`/graphs/${graphId}`, {
      [`GET /graphs/${graphId}`]: {
        status: 404,
        body: { code: "graph_not_found", message: "Grafo não encontrado." },
      },
      [`GET /graphs/${graphId}/versions`]: {
        status: 404,
        body: { code: "graph_not_found", message: "Grafo não encontrado." },
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Grafo não encontrado.");
  });
});
