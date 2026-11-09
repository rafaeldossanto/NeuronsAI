import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "@/app";
import { SessionContext, type OrganizationRole } from "@/accounts/auth/session-context";
import { SessionGate } from "@/accounts/auth/session-gate";
import { createApi } from "@/shared/api";
import { mockFetch, renderApp } from "@/test/helpers";

const userId = "0a000000-0000-4000-8000-000000000001";
const secondUser = "0a000000-0000-4000-8000-000000000002";
const orgId = "0b000000-0000-4000-8000-000000000001";
const otherOrg = "0b000000-0000-4000-8000-000000000002";
const runnerId = "0c000000-0000-4000-8000-000000000001";
const token = "nrn_synthetic_one_time_secret";
const runner = {
  id: runnerId,
  name: "Notebook",
  createdAt: "2026-11-05T12:00:00Z",
  lastSeenAt: null,
  revokedAt: null,
  connected: false,
  activeAgents: 0,
};

function accountApp(
  path: string,
  role: OrganizationRole = "owner",
  extra: Parameters<typeof mockFetch>[0] = {},
) {
  const routes = {
    "GET /auth/organizations": { body: { items: [{ id: orgId, name: "Equipe principal", role }] } },
    [`GET /auth/organizations/${orgId}/members`]: {
      body: {
        items: [
          { userId, displayName: "Alice", role },
          { userId: secondUser, displayName: "Bruno", role: "member" },
        ],
      },
    },
    "GET /runners": { body: { items: [runner] } },
    [`GET /auth/organizations/${orgId}/invitations`]: { body: { items: [] } },
    ...extra,
  };
  const mock = mockFetch(routes);
  const client = createQueryClient();
  const reload = vi.fn(async () => {});
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <SessionContext.Provider
        value={{
          account: { userId, organizationId: orgId, role },
          reload,
          switchOrganization: vi.fn(async () => {}),
        }}
      >
        <App api={createApi(mock.fetch)} queryClient={client} />
      </SessionContext.Provider>
    </MemoryRouter>,
  );
  return { ...view, calls: mock.calls, client, reload };
}

describe("organizações e membros", () => {
  it("o proprietário vê e confirma a mudança dos dados locais; o administrador não vê", async () => {
    const user = userEvent.setup();
    const summary = { graphs: 2, versions: 3, runs: 5, secrets: 1, triggers: 0, memories: 4 };
    const { calls } = accountApp("/organizations", "owner", {
      [`GET /auth/organizations/${orgId}/local-data`]: { body: summary },
      [`POST /auth/organizations/${orgId}/adopt-local-data`]: { body: summary },
    });

    expect(
      await screen.findByText(/2 grafos, 5 execuções, 1 segredo e 4 memórias/),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Mover dados locais para esta organização" }),
    );
    expect(screen.getByText(/Não dá para desfazer/)).toBeInTheDocument();
    expect(calls.some((call) => call.path.includes("adopt-local-data"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Confirmar e mover" }));

    expect(
      await screen.findByText(/Dados locais movidos para Equipe principal/),
    ).toBeInTheDocument();
    const posted = calls.find(
      (call) => call.path === `POST /auth/organizations/${orgId}/adopt-local-data`,
    );
    expect(posted?.body).toEqual({ confirm: true });
  });

  it("quem não é proprietário nem consulta os dados locais", async () => {
    const { calls } = accountApp("/organizations", "admin");
    await screen.findByText("Bruno");
    expect(calls.some((call) => call.path.includes("local-data"))).toBe(false);
  });

  it("mantém o modo local sem consultas ou navegação de conta", async () => {
    const { calls } = renderApp("/organizations", {});
    expect(await screen.findByText("Seu espaço local está pronto")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Runners" })).not.toBeInTheDocument();
    expect(calls.some((call) => /\/auth\/|\/runners/.test(call.path))).toBe(false);
  });
  it("protege o último proprietário e salva o papel de outro membro", async () => {
    const user = userEvent.setup();
    const { calls } = accountApp("/organizations", "owner", {
      [`PUT /auth/organizations/${orgId}/members/${secondUser}`]: { status: 204 },
    });
    expect(await screen.findByText(/É preciso manter um proprietário/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Papel de Alice" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Papel de Bruno" }), "viewer");
    await user.click(screen.getByRole("button", { name: "Salvar papel" }));
    expect(await screen.findByText("Papel salvo.")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({ role: "viewer" });
  });
  it("limita administradores a membros e leitores", async () => {
    const user = userEvent.setup();
    accountApp("/organizations", "admin");
    const select = await screen.findByRole("combobox", { name: "Papel de Bruno" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Membro", "Leitor"]);
    expect(screen.queryByRole("combobox", { name: "Papel de Alice" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Adicionar membro" }));
    expect(
      within(screen.getByRole("combobox", { name: "Papel do novo membro" })).queryByRole("option", {
        name: "Proprietário",
      }),
    ).not.toBeInTheDocument();
  });
  it.each(["member", "viewer"] as const)(
    "%s consulta membros sem controles administrativos",
    async (role) => {
      accountApp("/organizations", role);
      expect(await screen.findByText("Bruno")).toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Adicionar membro" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Criar organização" })).toBeInTheDocument();
    },
  );
  it("explica uma conta inexistente e impede sobrescrever membro pela inclusão", async () => {
    const user = userEvent.setup();
    const newUser = "0a000000-0000-4000-8000-000000000003";
    const { calls } = accountApp("/organizations", "owner", {
      [`PUT /auth/organizations/${orgId}/members/${newUser}`]: {
        status: 404,
        body: {
          code: "account_not_found",
          message: "Conta não encontrada. Entre no NeuronsAI primeiro.",
        },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Adicionar membro" }));
    const input = screen.getByLabelText("ID da conta");
    await user.type(input, secondUser);
    await user.click(screen.getByRole("button", { name: "Adicionar à organização" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("já participa");
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
    await user.clear(input);
    await user.type(input, newUser);
    await user.click(screen.getByRole("button", { name: "Adicionar à organização" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Conta não encontrada");
  });
  it("cria uma organização sem trocar o espaço implicitamente", async () => {
    const user = userEvent.setup();
    const { calls } = accountApp("/organizations", "viewer", {
      "POST /auth/organizations": { status: 201, body: { id: otherOrg, name: "Novo espaço" } },
    });
    await user.click(await screen.findByRole("button", { name: "Criar organização" }));
    await user.type(screen.getByLabelText("Nome da organização"), "Novo espaço");
    await user.click(screen.getByRole("button", { name: "Criar espaço" }));
    expect(await screen.findByText(/Organização criada/)).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ name: "Novo espaço" });
    expect(calls.some((call) => call.path === "POST /auth/organization")).toBe(false);
  });
  it("troca o espaço pela sessão e remonta o App sem reutilizar o cache privado", async () => {
    const user = userEvent.setup();
    let selected = orgId;
    const mock = mockFetch({
      "GET /auth/session": () => ({
        body: {
          enabled: true,
          authenticated: true,
          userId,
          organizationId: selected,
          role: "owner",
        },
      }),
      "GET /auth/organizations": {
        body: {
          items: [
            { id: orgId, name: "Principal", role: "owner" },
            { id: otherOrg, name: "Outro", role: "owner" },
          ],
        },
      },
      [`GET /auth/organizations/${orgId}/members`]: {
        body: { items: [{ userId, displayName: "Nome privado anterior", role: "owner" }] },
      },
      [`GET /auth/organizations/${otherOrg}/members`]: {
        body: { items: [{ userId, displayName: "Nome do outro espaço", role: "owner" }] },
      },
      "POST /auth/organization": () => {
        selected = otherOrg;
        return { status: 204 };
      },
    });
    const api = createApi(mock.fetch);
    render(
      <MemoryRouter initialEntries={["/organizations"]}>
        <SessionGate api={api}>
          <App api={api} />
        </SessionGate>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Nome privado anterior/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Usar organização" }));
    expect(await screen.findByText(/Nome do outro espaço/)).toBeInTheDocument();
    expect(screen.queryByText(/Nome privado anterior/)).not.toBeInTheDocument();
    expect(mock.calls.find((call) => call.path === "POST /auth/organization")?.body).toEqual({
      organizationId: otherOrg,
    });
  });
});

describe("runners da organização", () => {
  it("mostra conexão real e agentes e mantém token somente no painel de criação", async () => {
    const user = userEvent.setup();
    const { client } = accountApp("/runners", "owner", {
      "GET /runners": { body: { items: [{ ...runner, connected: true, activeAgents: 2 }] } },
      "POST /runners": { status: 201, body: { id: runnerId, name: "Notebook novo", token } },
    });
    expect(await screen.findByText("Conectado")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cadastrar runner" }));
    await user.type(screen.getByLabelText("Nome do runner"), "Notebook novo");
    await user.click(screen.getByRole("button", { name: "Gerar token de conexão" }));
    expect(await screen.findByLabelText("Token do runner")).toHaveValue(token);
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data),
      ),
    ).not.toContain(token);
    await user.click(screen.getByRole("button", { name: "Copiar token" }));
    expect(await navigator.clipboard.readText()).toBe(token);
    await user.click(screen.getByRole("button", { name: "Concluir" }));
    expect(screen.queryByDisplayValue(token)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cadastrar runner" }));
    expect(screen.queryByLabelText("Token do runner")).not.toBeInTheDocument();
  });
  it.each(["member", "viewer"] as const)(
    "%s pode consultar sem cadastrar ou revogar",
    async (role) => {
      accountApp("/runners", role);
      expect(await screen.findByText("Desconectado")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cadastrar runner" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Revogar Notebook/ })).not.toBeInTheDocument();
    },
  );
  it("confirma a revogação antes de invalidar a listagem", async () => {
    const user = userEvent.setup();
    let revoked = false;
    const { calls } = accountApp("/runners", "admin", {
      "GET /runners": () => ({
        body: { items: [{ ...runner, revokedAt: revoked ? "2026-11-05T13:00:00Z" : null }] },
      }),
      "DELETE /runners/Notebook": () => {
        revoked = true;
        return { status: 204 };
      },
    });
    await user.click(await screen.findByRole("button", { name: "Revogar Notebook" }));
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Confirmar revogação" }));
    expect(await screen.findByText("Revogado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revogar Notebook" })).not.toBeInTheDocument();
  });
  it("apresenta falha e permite repetir a consulta", async () => {
    const user = userEvent.setup();
    let failed = true;
    accountApp("/runners", "owner", {
      "GET /runners": () =>
        failed
          ? { status: 503, body: { code: "unavailable", message: "Consulta indisponível." } }
          : { body: { items: [] } },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Consulta indisponível");
    failed = false;
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() =>
      expect(screen.getByText("Nenhum computador cadastrado")).toBeInTheDocument(),
    );
  });
});

it("creates and cancels invitations by e-mail without requiring an existing account id", async () => {
  const user = userEvent.setup();
  const id = "0d000000-0000-4000-8000-000000000001";
  const { calls } = accountApp("/organizations", "owner", {
    [`GET /auth/organizations/${orgId}/invitations`]: {
      body: {
        items: [
          { id, email: "invite@example.test", role: "member", expiresAt: "2026-12-01T12:00:00Z" },
        ],
      },
    },
    [`POST /auth/organizations/${orgId}/invitations`]: {
      status: 201,
      body: { id, email: "new@example.test", role: "viewer", expiresAt: "2026-12-01T12:00:00Z" },
    },
    [`DELETE /auth/organizations/${orgId}/invitations/${id}`]: { status: 204 },
  });
  await user.type(await screen.findByLabelText("E-mail do convite"), "new@example.test");
  await user.selectOptions(screen.getByLabelText("Papel do convite"), "viewer");
  await user.click(screen.getByRole("button", { name: "Criar convite" }));
  expect(await screen.findByText(/Convite criado/)).toBeInTheDocument();
  expect(
    calls.find((call) => call.method === "POST" && call.path.endsWith("/invitations"))?.body,
  ).toEqual({ email: "new@example.test", role: "viewer" });
  await user.click(screen.getByRole("button", { name: "Cancelar convite de invite@example.test" }));
  expect(await screen.findByText("Convite cancelado.")).toBeInTheDocument();
});
