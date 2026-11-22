import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "@/app";
import { SessionContext, type OrganizationRole } from "@/accounts/auth/session-context";
import { createApi } from "@/shared/api";
import { graphSummary, mockFetch } from "@/test/helpers";

const me = "0a000000-0000-4000-8000-000000000001";
const someoneElse = "0a000000-0000-4000-8000-000000000002";
const orgId = "0b000000-0000-4000-8000-000000000001";
const name = graphSummary.name;
const base = `/graphs/${graphSummary.id}`;

const pendingBy = (id: string, requester: string) => ({
  requestedBy: { id, name: requester },
  requestedAt: "2026-11-22T10:00:00.000Z",
});

type Routes = Parameters<typeof mockFetch>[0];

function renderAs(role: OrganizationRole, deletionRequest: unknown, extra: Routes = {}) {
  const mock = mockFetch({
    "GET /auth/organizations": { body: { items: [{ id: orgId, name: "Equipe", role }] } },
    "GET /graphs": { body: { items: [{ ...graphSummary, deletionRequest }] } },
    [`GET ${base}`]: { body: { ...graphSummary, draft: null, latestVersion: null } },
    ...extra,
  });
  render(
    <MemoryRouter initialEntries={["/graphs"]}>
      <SessionContext.Provider
        value={{
          account: { userId: me, organizationId: orgId, role },
          reload: vi.fn(async () => {}),
          switchOrganization: vi.fn(async () => {}),
        }}
      >
        <App api={createApi(mock.fetch)} queryClient={createQueryClient()} />
      </SessionContext.Provider>
    </MemoryRouter>,
  );
  return mock;
}

const button = (label: string) => screen.queryByRole("button", { name: label });
const trash = `Excluir ${name}`;
const ask = `Solicitar exclusão de ${name}`;
const approve = `Aprovar exclusão de ${name}`;
const reject = `Recusar exclusão de ${name}`;
const cancel = `Cancelar solicitação de exclusão de ${name}`;

describe("excluir projeto, por papel", () => {
  it.each(["owner", "admin"] as const)("%s vê a lixeira e, sem pedido, nada mais", async (role) => {
    renderAs(role, null);
    expect(await screen.findByRole("button", { name: trash })).toBeEnabled();
    expect(button(ask)).not.toBeInTheDocument();
    expect(button(approve)).not.toBeInTheDocument();
    expect(screen.queryByText(/Exclusão solicitada/)).not.toBeInTheDocument();
  });

  it("membro vê Solicitar exclusão no lugar da lixeira", async () => {
    renderAs("member", null);
    expect(await screen.findByRole("button", { name: ask })).toBeInTheDocument();
    expect(button(trash)).not.toBeInTheDocument();
  });

  it("leitor não vê lixeira nem pedido, mesmo com pedido pendente", async () => {
    renderAs("viewer", pendingBy(someoneElse, "Bruno"));
    await screen.findByRole("link", { name });
    expect(button(trash)).not.toBeInTheDocument();
    expect(button(ask)).not.toBeInTheDocument();
    expect(button(cancel)).not.toBeInTheDocument();
    expect(screen.queryByText(/Exclusão solicitada/)).not.toBeInTheDocument();
  });

  it("membro pede a exclusão pelo diálogo curto, e Cancelar não chama o servidor", async () => {
    const mock = renderAs("member", null, {
      [`POST ${base}/deletion-request`]: {
        status: 201,
        body: pendingBy(me, "Alice"),
      },
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: ask }));
    const dialog = await screen.findByRole("alertdialog", { name: "Solicitar exclusão?" });
    expect(dialog).toHaveAccessibleDescription(
      `Pedir a exclusão de “${name}”? Um administrador vai aprovar ou recusar.`,
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mock.calls.some((call) => call.method === "POST")).toBe(false);

    await user.click(screen.getByRole("button", { name: ask }));
    await user.click(await screen.findByRole("button", { name: "Solicitar" }));
    await waitFor(() =>
      expect(
        mock.calls.filter((call) => call.path === `POST ${base}/deletion-request`),
      ).toHaveLength(1),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("membro vê o selo e cancela o próprio pedido", async () => {
    const mock = renderAs("member", pendingBy(me, "Alice"), {
      [`DELETE ${base}/deletion-request`]: { status: 204 },
    });
    const user = userEvent.setup();

    expect(await screen.findByText("Exclusão solicitada")).toBeInTheDocument();
    expect(button(ask)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: cancel }));

    await waitFor(() =>
      expect(mock.calls.some((call) => call.path === `DELETE ${base}/deletion-request`)).toBe(true),
    );
  });

  it("membro não cancela o pedido de outra pessoa", async () => {
    renderAs("member", pendingBy(someoneElse, "Bruno"));
    expect(await screen.findByText("Exclusão solicitada")).toBeInTheDocument();
    expect(button(cancel)).not.toBeInTheDocument();
    expect(button(ask)).not.toBeInTheDocument();
  });

  it("administrador vê quem pediu e recusa o pedido", async () => {
    const mock = renderAs("admin", pendingBy(someoneElse, "Bruno"), {
      [`POST ${base}/deletion-request/reject`]: { status: 204 },
    });
    const user = userEvent.setup();

    expect(await screen.findByText(/Exclusão solicitada por Bruno/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: reject }));

    await waitFor(() =>
      expect(mock.calls.some((call) => call.path === `POST ${base}/deletion-request/reject`)).toBe(
        true,
      ),
    );
    expect(mock.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("administrador aprova pelo diálogo de exclusão, com o texto das versões", async () => {
    const mock = renderAs("owner", pendingBy(someoneElse, "Bruno"), {
      [`GET ${base}`]: { body: { ...graphSummary, draft: null, latestVersion: 2 } },
      [`POST ${base}/deletion-request/approve`]: { status: 204 },
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: approve }));
    const dialog = await screen.findByRole("alertdialog", { name: "Excluir projeto?" });
    await waitFor(() =>
      expect(dialog).toHaveAccessibleDescription(
        `“${name}” será excluído deste computador, com as 2 versões publicadas e o histórico de execuções. Essa ação não pode ser desfeita.`,
      ),
    );
    const confirm = within(dialog).getByRole("button", { name: "Excluir" });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    await waitFor(() =>
      expect(mock.calls.some((call) => call.path === `POST ${base}/deletion-request/approve`)).toBe(
        true,
      ),
    );
  });

  it("aprovar com execução em andamento mostra a recusa e mantém o pedido", async () => {
    renderAs("admin", pendingBy(someoneElse, "Bruno"), {
      [`POST ${base}/deletion-request/approve`]: {
        status: 409,
        body: {
          code: "graph_has_active_runs",
          message: "Pare as execuções em andamento antes de excluir o projeto.",
        },
      },
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: approve }));
    const dialog = await screen.findByRole("alertdialog", { name: "Excluir projeto?" });
    const confirm = within(dialog).getByRole("button", { name: "Excluir" });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Pare as execuções em andamento antes de excluir o projeto.",
    );
    expect(screen.getByText(/Exclusão solicitada por Bruno/)).toBeInTheDocument();
  });
});
