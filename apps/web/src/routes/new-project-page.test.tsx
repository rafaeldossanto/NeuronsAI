import { StrictMode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { instantiateTemplate, listTemplates, validateGraph } from "@neurons/graph-schema";
import { App, createQueryClient } from "@/app";
import { createApi } from "@/lib/api";
import { graphId, graphSummary, mockFetch, renderApp } from "@/test/helpers";

type Routes = Parameters<typeof mockFetch>[0];
const cwd = "/runner-workdir";
const resources = {
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
};
function routes(name: string, draft: unknown = null): Routes {
  return {
    ...resources,
    "POST /graphs": { status: 201, body: { ...graphSummary, name } },
    [`PATCH /graphs/${graphId}`]: { body: { ...graphSummary, name } },
    [`GET /graphs/${graphId}`]: { body: { ...graphSummary, name, latestVersion: null, draft } },
    [`GET /graphs/${graphId}/versions`]: { body: { items: [] } },
  };
}
function renderStrict(replies: Routes) {
  const mocked = mockFetch(replies);
  render(
    <StrictMode>
      <MemoryRouter initialEntries={["/new"]}>
        <App api={createApi(mocked.fetch)} queryClient={createQueryClient()} />
      </MemoryRouter>
    </StrictMode>,
  );
  return mocked;
}

describe("novo projeto e templates", () => {
  it("lista os três templates, mostra prévias só leitura e não cria projeto ao abrir a página", () => {
    const mocked = renderStrict(resources);
    expect(screen.getByRole("heading", { level: 1, name: "Novo projeto" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Projeto em branco" })).toBeInTheDocument();
    for (const template of listTemplates()) {
      const card = screen.getByRole("article", { name: template.name });
      expect(within(card).getByText(template.description)).toBeInTheDocument();
      const preview = within(card).getByRole("region", { name: "Canvas da execução" });
      expect(preview.querySelectorAll(".react-flow__node.draggable")).toHaveLength(0);
      expect(preview.querySelectorAll(".react-flow__node").length).toBeGreaterThan(0);
      expect(within(card).queryByText("Precisa de chave de API") !== null).toBe(
        template.requiresApiKey,
      );
    }
    expect(screen.getAllByRole("region", { name: "Canvas da execução" })).toHaveLength(3);
    expect(mocked.calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("cria projeto em branco uma única vez no StrictMode e abre um canvas vazio", async () => {
    const mocked = renderStrict(routes("Projeto sem nome"));
    await userEvent.click(screen.getByRole("button", { name: "Criar projeto em branco" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Projeto sem nome" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Crie seu primeiro fluxo")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^block-/)).toHaveLength(0);
    expect(mocked.calls.filter((call) => call.path === "POST /graphs")).toHaveLength(1);
    expect(mocked.calls.find((call) => call.path === "POST /graphs")?.body).toEqual({
      name: "Projeto sem nome",
    });
    expect(mocked.calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it.each(listTemplates())(
    "cria $id com novo id e conteúdo próprio, sem publicar",
    async (template) => {
      const draft = instantiateTemplate(template.id, { projectId: graphId, cwd });
      const { calls } = renderApp("/new", routes(template.name, draft));
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: `Usar template ${template.name}` }));
      const dialog = screen.getByRole("dialog", { name: "Criar projeto a partir de template" });
      if (template.requiresWorkdir)
        await user.type(within(dialog).getByLabelText("Pasta de trabalho no runner"), cwd);
      await user.click(within(dialog).getByRole("button", { name: "Criar projeto com template" }));
      expect(
        await screen.findByRole("heading", { level: 1, name: template.name }),
      ).toBeInTheDocument();
      expect(calls.filter((call) => call.path === "POST /graphs")).toHaveLength(1);
      expect(calls.find((call) => call.path === `PATCH /graphs/${graphId}`)?.body).toEqual({
        name: template.name,
        draft,
      });
      expect(draft.id).not.toBe(template.graph.id);
      expect(validateGraph(draft)).toMatchObject({ ok: true });
      expect(calls.some((call) => call.method === "POST" && call.path.includes("/versions"))).toBe(
        false,
      );
      expect(calls.some((call) => call.path === "POST /runs")).toBe(false);
    },
  );

  it("exige uma pasta absoluta antes de criar um template com terminais", async () => {
    const { calls } = renderApp("/new", resources);
    await userEvent.click(
      screen.getByRole("button", { name: "Usar template Pesquisa com revisor" }),
    );
    await userEvent.type(screen.getByLabelText("Pasta de trabalho no runner"), ".");
    await userEvent.click(screen.getByRole("button", { name: "Criar projeto com template" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("pasta de trabalho absoluta");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("mostra erro de criação sem sair do formulário", async () => {
    renderApp("/new", {
      ...resources,
      "POST /graphs": {
        status: 500,
        body: { code: "test_error", message: "Não foi possível criar o projeto agora." },
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Usar template Venda → pós-venda" }));
    await userEvent.click(screen.getByRole("button", { name: "Criar projeto com template" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível criar o projeto agora.",
    );
    expect(
      screen.getByRole("dialog", { name: "Criar projeto a partir de template" }),
    ).toBeInTheDocument();
  });

  it("repete o salvamento que falhou sem criar outro projeto", async () => {
    const template = listTemplates()[0]!;
    const draft = instantiateTemplate(template.id, { projectId: graphId });
    let saves = 0;
    const { calls } = renderApp("/new", {
      ...routes(template.name, draft),
      [`PATCH /graphs/${graphId}`]: () =>
        ++saves === 1
          ? { status: 500, body: { code: "test_error", message: "Falha ao salvar o rascunho." } }
          : { body: { ...graphSummary, name: template.name } },
    });
    await userEvent.click(screen.getByRole("button", { name: `Usar template ${template.name}` }));
    await userEvent.click(screen.getByRole("button", { name: "Criar projeto com template" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao salvar o rascunho.");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Criar projeto com template" })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Criar projeto com template" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: template.name }),
    ).toBeInTheDocument();
    expect(calls.filter((call) => call.path === "POST /graphs")).toHaveLength(1);
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(2);
  });
  it("reaproveita o projeto em branco ao trocar de template depois de uma falha", async () => {
    const first = listTemplates()[0]!;
    const draft = instantiateTemplate(first.id, { projectId: graphId });
    let saves = 0;
    const { calls } = renderApp("/new", {
      ...routes(first.name, draft),
      [`PATCH /graphs/${graphId}`]: () =>
        ++saves === 1
          ? { status: 500, body: { code: "test_error", message: "Falha ao salvar o rascunho." } }
          : { body: { ...graphSummary, name: first.name } },
    });
    await userEvent.click(screen.getByRole("button", { name: `Usar template ${first.name}` }));
    await userEvent.click(screen.getByRole("button", { name: "Criar projeto com template" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao salvar o rascunho.");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: `Usar template ${first.name}` }));
    await userEvent.click(screen.getByRole("button", { name: "Criar projeto com template" }));
    expect(await screen.findByRole("heading", { level: 1, name: first.name })).toBeInTheDocument();
    expect(calls.filter((call) => call.path === "POST /graphs")).toHaveLength(1);
  });
});
