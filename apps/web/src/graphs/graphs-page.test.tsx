import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { graph, graphSummary, renderApp } from "@/test/helpers";

describe("lista de projetos", () => {
  it("mostra o carregando e depois os projetos, com link para o editor", async () => {
    renderApp("/graphs", { "GET /graphs": { body: { items: [graphSummary] } } });

    expect(screen.getByRole("status", { name: "Carregando projetos" })).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: "Revisão de código" });
    expect(link).toHaveAttribute("href", `/graphs/${graphSummary.id}`);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("avisa quando não há projetos", async () => {
    renderApp("/graphs", { "GET /graphs": { body: { items: [] } } });
    expect(await screen.findByText("Nenhum projeto ainda")).toBeInTheDocument();
  });

  it("mostra a mensagem do servidor quando a lista falha", async () => {
    renderApp("/graphs", {
      "GET /graphs": {
        status: 503,
        body: { code: "database_down", message: "Banco indisponível." },
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Banco indisponível.");
  });

  it("cria um projeto, limpa o campo e recarrega a lista", async () => {
    let items: (typeof graphSummary)[] = [];
    const { calls } = renderApp("/graphs", {
      "GET /graphs": () => ({ body: { items } }),
      "POST /graphs": () => {
        items = [graphSummary];
        return { status: 201, body: graph };
      },
    });
    const user = userEvent.setup();

    await screen.findByText("Nenhum projeto ainda");
    await user.type(screen.getByLabelText("Nome do novo projeto"), "  Revisão de código ");
    await user.click(screen.getByRole("button", { name: "Criar projeto" }));

    expect(await screen.findByRole("link", { name: "Revisão de código" })).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "Revisão de código" });
    await waitFor(() => expect(screen.getByLabelText("Nome do novo projeto")).toHaveValue(""));
  });

  it("mostra o erro de validação do servidor ao criar", async () => {
    renderApp("/graphs", {
      "GET /graphs": { body: { items: [] } },
      "POST /graphs": { status: 400, body: { code: "bad_request", message: "Nome inválido." } },
    });
    const user = userEvent.setup();

    await screen.findByText("Nenhum projeto ainda");
    await user.type(screen.getByLabelText("Nome do novo projeto"), "x");
    await user.click(screen.getByRole("button", { name: "Criar projeto" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nome inválido.");
  });
});
