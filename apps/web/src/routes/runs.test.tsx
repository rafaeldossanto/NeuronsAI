import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp, runId, runSummary } from "@/test/helpers";

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
});
