import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp, runDetail, runId, runSummary } from "@/test/helpers";

const event = {
  runId,
  seq: 1,
  type: "RunStarted",
  agent: null,
  payload: { input: "Revise o PR 42" },
  at: "2026-11-02T12:00:01.000Z",
};

describe("execuções", () => {
  it("lista as execuções com o status", async () => {
    renderApp("/runs", { "GET /runs": { body: { items: [runSummary] } } });

    expect(screen.getByRole("status", { name: "Carregando execuções" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: runId })).toHaveAttribute(
      "href",
      `/runs/${runId}`,
    );
    expect(screen.getByText("Em execução")).toBeInTheDocument();
  });

  it("avisa quando não há execuções", async () => {
    renderApp("/runs", { "GET /runs": { body: { items: [] } } });
    expect(await screen.findByText("Nenhuma execução ainda")).toBeInTheDocument();
  });

  it("mostra erro de rede e tenta de novo", async () => {
    let attempts = 0;
    renderApp("/runs", {
      "GET /runs": () => {
        attempts += 1;
        if (attempts === 1) return () => Promise.reject(new TypeError("fetch failed"));
        return { body: { items: [runSummary] } };
      },
    });
    const user = userEvent.setup();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível falar com o servidor.",
    );
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("link", { name: runId })).toBeInTheDocument();
  });

  it("detalha a execução: status, entrada, consumo e eventos", async () => {
    renderApp(`/runs/${runId}`, {
      [`GET /runs/${runId}`]: {
        body: { ...runDetail, status: "succeeded", finishedAt: "2026-11-02T12:05:00.000Z" },
      },
      [`GET /runs/${runId}/events`]: { body: { items: [event] } },
    });

    expect(await screen.findByText("Concluída")).toBeInTheDocument();
    expect(screen.getByText("Revise o PR 42", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("@revisor: $0.0123 · 3 turnos")).toBeInTheDocument();
    expect(await screen.findByText("RunStarted")).toBeInTheDocument();
  });

  it("mostra o erro quando a execução não existe", async () => {
    const notFound = {
      status: 404,
      body: { code: "run_not_found", message: "Execução não encontrada." },
    };
    renderApp(`/runs/${runId}`, {
      [`GET /runs/${runId}`]: notFound,
      [`GET /runs/${runId}/events`]: notFound,
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Execução não encontrada.");
  });
});
