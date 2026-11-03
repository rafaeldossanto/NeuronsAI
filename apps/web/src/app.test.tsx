import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { graphSummary, renderApp } from "@/test/helpers";

describe("navegação", () => {
  it("abre em Grafos e troca para Execuções pelo menu", async () => {
    renderApp("/", {
      "GET /graphs": { body: { items: [graphSummary] } },
      "GET /runs": { body: { items: [] } },
    });
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "Grafos" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Execuções" }));
    expect(await screen.findByRole("heading", { name: "Execuções" })).toBeInTheDocument();
  });
});
