import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App, createQueryClient } from "@/app";
import { createApi } from "@/lib/api";
import { graphId, graphSummary, mockFetch } from "@/test/helpers";

describe("entrada da landing para um novo projeto", () => {
  it("cria apenas uma vez no StrictMode e abre um canvas vazio, sem a demonstração", async () => {
    const mocked = mockFetch({
      "POST /graphs": { status: 201, body: { ...graphSummary, name: "Projeto sem nome" } },
      [`GET /graphs/${graphId}`]: {
        body: { ...graphSummary, name: "Projeto sem nome", latestVersion: null, draft: null },
      },
      [`GET /graphs/${graphId}/versions`]: { body: { items: [] } },
      "GET /memories": { body: { items: [] } },
      "GET /secrets": { body: { names: [] } },
      "GET /connections": {
        body: {
          profile: "local",
          secretsEnabled: false,
          claude: {
            installed: false,
            connected: false,
            signingIn: false,
            message: "Instale o Claude Code.",
          },
          chatgpt: { available: false, message: "Em breve" },
        },
      },
    });
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/new"]}>
          <App api={createApi(mocked.fetch)} queryClient={createQueryClient()} />
        </MemoryRouter>
      </StrictMode>,
    );
    expect(await screen.findByRole("heading", { name: "Projeto sem nome" })).toBeInTheDocument();
    expect(screen.getByText("Crie seu primeiro fluxo")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^block-/)).toHaveLength(0);
    expect(mocked.calls.filter((call) => call.path === "POST /graphs")).toHaveLength(1);
    expect(mocked.calls.find((call) => call.path === "POST /graphs")?.body).toEqual({
      name: "Projeto sem nome",
    });
  });
});
