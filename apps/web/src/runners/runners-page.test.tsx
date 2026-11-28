import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/app";
import { SessionContext, type OrganizationRole } from "@/accounts/auth/session-context";
import { ApiProvider, createApi } from "@/shared/api";
import { formatDateTime } from "@/shared/format";
import { mockFetch } from "@/test/helpers";
import { RunnersPage } from "./runners-page";

const me = "0a000000-0000-4000-8000-000000000001";
const orgId = "0b000000-0000-4000-8000-000000000001";
const notebook = "0c000000-0000-4000-8000-000000000001";
const desktop = "0c000000-0000-4000-8000-000000000002";
const server = "0c000000-0000-4000-8000-000000000003";
const seenAt = "2026-11-22T10:00:00.000Z";

const runner = (id: string, name: string, extra: object = {}) => ({
  id,
  name,
  createdAt: "2026-11-01T10:00:00.000Z",
  lastSeenAt: null,
  revokedAt: null,
  connected: false,
  activeAgents: 0,
  ...extra,
});
const personal = {
  items: [
    runner(notebook, "Notebook", { connected: true, activeAgents: 2, lastSeenAt: seenAt }),
    runner(desktop, "Desktop"),
  ],
};
const organization = { items: [runner(server, "Servidor do time", { connected: true })] };

type Routes = Parameters<typeof mockFetch>[0];

function renderAs(role: OrganizationRole, extra: Routes = {}) {
  const mock = mockFetch({
    "GET /runners/personal": { body: personal },
    "GET /runners": { body: organization },
    ...extra,
  });
  render(
    <MemoryRouter>
      <SessionContext.Provider
        value={{
          account: { userId: me, organizationId: orgId, role },
          reload: vi.fn(async () => {}),
          switchOrganization: vi.fn(async () => {}),
        }}
      >
        <QueryClientProvider client={createQueryClient()}>
          <ApiProvider api={createApi(mock.fetch)}>
            <RunnersPage />
          </ApiProvider>
        </QueryClientProvider>
      </SessionContext.Provider>
    </MemoryRouter>,
  );
  return mock;
}

const calls = (mock: ReturnType<typeof mockFetch>, path: string) =>
  mock.calls.filter((call) => call.path === path);

describe("página de runners: abas Pessoal e Organização", () => {
  it("abre na aba Pessoal, com as abas acessíveis", async () => {
    renderAs("member");

    const list = screen.getByRole("tablist", { name: "Tipo de runner" });
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Pessoal", "Organização"]);
    expect(screen.getByRole("tab", { name: "Pessoal" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Organização" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    const panel = await screen.findByRole("tabpanel", { name: "Pessoal" });
    expect(panel).toHaveAttribute(
      "id",
      screen.getByRole("tab", { name: "Pessoal" }).getAttribute("aria-controls"),
    );
    expect(
      await within(panel).findByText(
        /Abra o app do NeuronsAI no seu computador e entre na sua conta/,
      ),
    ).toHaveTextContent(
      "Abra o app do NeuronsAI no seu computador e entre na sua conta: ele se conecta sozinho e roda só as execuções que você iniciar, com a assinatura logada nele.",
    );
  });

  it("lista os meus runners com estado, agentes ativos e visto por último", async () => {
    const mock = renderAs("member");

    const list = await screen.findByRole("list", { name: "Seus computadores" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(within(first!).getByRole("heading", { name: "Notebook" })).toBeInTheDocument();
    expect(within(first!).getByText("Conectado")).toBeInTheDocument();
    expect(within(first!).getByText("2")).toBeInTheDocument();
    expect(within(first!).getByText(formatDateTime(seenAt))).toBeInTheDocument();
    expect(within(second!).getByText("Desconectado")).toBeInTheDocument();
    expect(within(second!).getByText("Ainda não conectou")).toBeInTheDocument();
    // The organization's runners are not asked for until their tab opens.
    expect(calls(mock, "GET /runners")).toHaveLength(0);
  });

  it("mostra o aviso e a lista da organização na outra aba", async () => {
    const mock = renderAs("admin");
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Organização" }));

    const panel = await screen.findByRole("tabpanel", { name: "Organização" });
    expect(
      within(panel).getByText(
        "Um computador da organização roda execuções de qualquer membro e as agendadas ou por webhook, com a assinatura logada nele.",
      ),
    ).toBeInTheDocument();
    expect(await within(panel).findByRole("heading", { name: "Servidor do time" })).toBeVisible();
    expect(within(panel).getByRole("button", { name: "Cadastrar runner" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Revogar Servidor do time" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Organização" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(calls(mock, "GET /runners")).not.toHaveLength(0);
  });

  it("quem não é proprietário nem administrador só vê a aba da organização", async () => {
    renderAs("member");
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Organização" }));

    expect(await screen.findByRole("heading", { name: "Servidor do time" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cadastrar runner" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Revogar/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Seu papel permite consultar os runners/)).toBeInTheDocument();
  });

  it("troca de aba pelo teclado", async () => {
    renderAs("member");
    const user = userEvent.setup();
    const pessoal = screen.getByRole("tab", { name: "Pessoal" });
    const organizacao = screen.getByRole("tab", { name: "Organização" });
    expect(pessoal).toHaveAttribute("tabindex", "0");
    expect(organizacao).toHaveAttribute("tabindex", "-1");

    pessoal.focus();
    await user.keyboard("{ArrowRight}");
    expect(organizacao).toHaveAttribute("aria-selected", "true");
    expect(organizacao).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(pessoal).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(organizacao).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    expect(pessoal).toHaveAttribute("aria-selected", "true");
  });

  it("desconectar pede confirmação, e Cancelar não chama o servidor", async () => {
    const mock = renderAs("member", {
      [`DELETE /runners/personal/${notebook}`]: { status: 204 },
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Desconectar Notebook" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Desconectar computador?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mock.calls.some((call) => call.method === "DELETE")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Desconectar Notebook" }));
    const again = await screen.findByRole("alertdialog", { name: "Desconectar computador?" });
    await user.click(within(again).getByRole("button", { name: "Desconectar" }));

    await waitFor(() =>
      expect(calls(mock, `DELETE /runners/personal/${notebook}`)).toHaveLength(1),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("um runner já revogado não oferece Desconectar", async () => {
    renderAs("member", {
      "GET /runners/personal": {
        body: { items: [runner(desktop, "Desktop", { revokedAt: seenAt })] },
      },
    });

    expect(await screen.findByRole("heading", { name: "Desktop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Desconectar/ })).not.toBeInTheDocument();
  });

  it("gera um token pessoal avançado, mostrado uma única vez", async () => {
    const mock = renderAs("member", {
      "POST /runners/personal": {
        status: 201,
        body: { id: notebook, name: "Meu PC", token: "nrn_token-de-teste" },
      },
    });
    const user = userEvent.setup();

    await user.click(await screen.findByText("Avançado: rodar o runner à mão"));
    await user.click(screen.getByRole("button", { name: "Gerar token" }));
    await user.type(screen.getByLabelText("Nome do computador"), "  Meu PC  ");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Gerar token" }),
    );

    expect(await screen.findByDisplayValue("nrn_token-de-teste")).toBeInTheDocument();
    expect(
      screen.getByText("Guarde este token agora. Ele não será exibido novamente."),
    ).toBeVisible();
    expect(calls(mock, "POST /runners/personal")[0]?.body).toEqual({ name: "Meu PC" });
    expect(calls(mock, "POST /runners")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Concluir" }));
    expect(screen.queryByDisplayValue("nrn_token-de-teste")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("nrn_token-de-teste");
  });

  it("o leitor vê só o texto sobre a permissão, sem lista nem pedidos", async () => {
    const mock = renderAs("viewer");

    expect(
      await screen.findByText(/você precisa de permissão para executar projetos/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/Abra o app do NeuronsAI/)).not.toBeInTheDocument();
    expect(mock.calls).toHaveLength(0);
  });

  it("o proprietário cadastra um runner da organização pela outra aba", async () => {
    const mock = renderAs("owner", {
      "POST /runners": {
        status: 201,
        body: { id: server, name: "Novo", token: "nrn_token-da-organizacao" },
      },
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Organização" }));
    await user.click(await screen.findByRole("button", { name: "Cadastrar runner" }));
    await user.type(screen.getByLabelText("Nome do runner"), "Novo");
    await user.click(screen.getByRole("button", { name: "Gerar token de conexão" }));

    expect(await screen.findByDisplayValue("nrn_token-da-organizacao")).toBeInTheDocument();
    expect(calls(mock, "POST /runners")[0]?.body).toEqual({ name: "Novo" });
    expect(calls(mock, "POST /runners/personal")).toHaveLength(0);
  });
});
