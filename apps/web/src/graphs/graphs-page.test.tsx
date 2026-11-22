import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

  describe("excluir projeto", () => {
    const deletePath = `DELETE /graphs/${graphSummary.id}`;
    const dialogName = "Excluir projeto?";

    it("abre a confirmação com o nome do projeto e o foco em Cancelar", async () => {
      renderApp("/graphs", { "GET /graphs": { body: { items: [graphSummary] } } });
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: "Excluir Revisão de código" }));

      const dialog = await screen.findByRole("alertdialog", { name: dialogName });
      expect(dialog).toHaveAccessibleDescription(
        "“Revisão de código” será excluído deste computador. Essa ação não pode ser desfeita.",
      );
      expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    });

    it("Cancelar fecha sem chamar o DELETE", async () => {
      const { calls } = renderApp("/graphs", {
        "GET /graphs": { body: { items: [graphSummary] } },
      });
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: "Excluir Revisão de código" }));
      await user.click(await screen.findByRole("button", { name: "Cancelar" }));

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Revisão de código" })).toBeInTheDocument();
      expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    });

    it("Esc fecha sem chamar o DELETE", async () => {
      const { calls } = renderApp("/graphs", {
        "GET /graphs": { body: { items: [graphSummary] } },
      });
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: "Excluir Revisão de código" }));
      await screen.findByRole("alertdialog", { name: dialogName });
      fireEvent(screen.getByRole("alertdialog"), new Event("cancel", { cancelable: true }));

      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    });

    it("Excluir chama o DELETE certo e o projeto some da lista", async () => {
      let items: (typeof graphSummary)[] = [graphSummary];
      const { calls } = renderApp("/graphs", {
        "GET /graphs": () => ({ body: { items } }),
        [deletePath]: () => {
          items = [];
          return { status: 204 };
        },
      });
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: "Excluir Revisão de código" }));
      await user.click(await screen.findByRole("button", { name: "Excluir" }));

      expect(await screen.findByText("Nenhum projeto ainda")).toBeInTheDocument();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([deletePath]);
    });

    it("mostra o erro no diálogo e o mantém aberto", async () => {
      renderApp("/graphs", {
        "GET /graphs": { body: { items: [graphSummary] } },
        [deletePath]: { status: 500, body: { code: "boom", message: "Banco indisponível." } },
      });
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: "Excluir Revisão de código" }));
      await user.click(await screen.findByRole("button", { name: "Excluir" }));

      const dialog = await screen.findByRole("alertdialog", { name: dialogName });
      expect(within(dialog).getByRole("alert")).toHaveTextContent("Banco indisponível.");
      expect(screen.getByRole("link", { name: "Revisão de código" })).toBeInTheDocument();
    });

    it("explica que projeto com versão publicada não pode ser excluído (409)", async () => {
      renderApp("/graphs", {
        "GET /graphs": { body: { items: [graphSummary] } },
        [deletePath]: {
          status: 409,
          body: { code: "graph_has_versions", message: "O grafo já tem versões publicadas." },
        },
      });
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: "Excluir Revisão de código" }));
      await user.click(await screen.findByRole("button", { name: "Excluir" }));

      const dialog = await screen.findByRole("alertdialog", { name: dialogName });
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "Projetos com versão publicada não podem ser excluídos.",
      );
    });
  });
});
