import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "@/app";
import { SessionContext, type OrganizationRole } from "@/accounts/auth/session-context";
import { createApi } from "@/shared/api";
import { graphId, graphSummary, mockFetch } from "@/test/helpers";

const me = "0a000000-0000-4000-8000-000000000001";
const dona = "0a000000-0000-4000-8000-000000000002";
const bruno = "0a000000-0000-4000-8000-000000000003";
const carla = "0a000000-0000-4000-8000-000000000004";
const diego = "0a000000-0000-4000-8000-000000000005";
const orgId = "0b000000-0000-4000-8000-000000000001";
const name = graphSummary.name;
const base = `/graphs/${graphId}`;
const when = "2026-11-22T10:00:00.000Z";

type Routes = Parameters<typeof mockFetch>[0];
type Access = { level: string; request: string | null; pendingRequests: number };

const project = (access: Partial<Access> = {}) => ({
  ...graphSummary,
  accessMode: "restricted",
  owner: { id: dona, name: "Dona" },
  deletionRequest: null,
  access: { level: "none", request: null, pendingRequests: 0, ...access },
});

const person = (id: string, label: string) => ({
  id,
  name: label,
  email: `${label.toLowerCase()}@exemplo.test`,
});
const entry = (
  id: string,
  label: string,
  status: "granted" | "blocked" | "requested",
  level: "use" | "edit" | null = null,
) => ({
  user: person(id, label),
  status,
  level,
  requestedAt: status === "requested" ? when : null,
  decidedAt: status === "requested" ? null : when,
});
const accessDetails = (entries: ReturnType<typeof entry>[], mode = "restricted") => ({
  mode,
  owner: { id: dona, name: "Dona" },
  entries,
});

function renderAs(role: OrganizationRole, routes: Routes, path = "/graphs") {
  const mock = mockFetch({
    "GET /auth/organizations": { body: { items: [{ id: orgId, name: "Equipe", role }] } },
    ...routes,
  });
  render(
    <MemoryRouter initialEntries={[path]}>
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

const list = (item: unknown): Routes => ({ "GET /graphs": { body: { items: [item] } } });
const called = (mock: ReturnType<typeof mockFetch>, path: string) =>
  mock.calls.filter((call) => call.path === path);

describe("projeto sem acesso na lista", () => {
  it("aparece com cadeado e sem link, e quem não tem acesso pede para entrar", async () => {
    const mock = renderAs("member", {
      ...list(project()),
      [`POST ${base}/access-request`]: { status: 201, body: { requestedAt: when } },
    });
    const user = userEvent.setup();

    expect(await screen.findByText(name)).toBeInTheDocument();
    expect(screen.getByText("(sem acesso)")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: `Abrir ${name}` })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Excluir ${name}` })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Solicitar exclusão de ${name}` }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: `Solicitar acesso a ${name}` }));
    await waitFor(() => expect(called(mock, `POST ${base}/access-request`)).toHaveLength(1));
  });

  it("com pedido enviado mostra o estado e deixa cancelar", async () => {
    const mock = renderAs("member", {
      ...list(project({ request: "pending" })),
      [`DELETE ${base}/access-request`]: { status: 204 },
    });
    const user = userEvent.setup();

    expect(await screen.findByText("Pedido enviado")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Solicitar acesso a ${name}` }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `Cancelar pedido de acesso a ${name}` }));
    await waitFor(() => expect(called(mock, `DELETE ${base}/access-request`)).toHaveLength(1));
  });

  it("bloqueado vê o aviso e não pode pedir de novo", async () => {
    renderAs("member", list(project({ request: "blocked" })));

    expect(await screen.findByText("Acesso bloqueado pelo dono")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Solicitar acesso a ${name}` }),
    ).not.toBeInTheDocument();
  });

  it("mostra o motivo quando o servidor recusa o pedido", async () => {
    renderAs("member", {
      ...list(project()),
      [`POST ${base}/access-request`]: {
        status: 403,
        body: { code: "graph_access_blocked", message: "O dono do projeto bloqueou o seu acesso." },
      },
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: `Solicitar acesso a ${name}` }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "O dono do projeto bloqueou o seu acesso.",
    );
  });
});

describe("quem gerencia o acesso", () => {
  it("quem gerencia vê o botão Acesso e o selo com os pedidos", async () => {
    renderAs("member", list(project({ level: "manage", pendingRequests: 2 })));
    expect(
      await screen.findByRole("button", { name: `Gerenciar acesso a ${name}` }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 pedidos de acesso")).toBeInTheDocument();
  });

  it("um pedido só usa o singular", async () => {
    renderAs("owner", list(project({ level: "manage", pendingRequests: 1 })));
    expect(await screen.findByText("1 pedido de acesso")).toBeInTheDocument();
  });

  it("quem edita ou só usa não vê o botão de acesso", async () => {
    renderAs("member", list(project({ level: "edit" })));
    await screen.findByRole("link", { name });
    expect(
      screen.queryByRole("button", { name: `Gerenciar acesso a ${name}` }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/pedidos? de acesso/)).not.toBeInTheDocument();
  });

  const members = {
    "GET /auth/organizations/0b000000-0000-4000-8000-000000000001/members": {
      body: {
        items: [
          { userId: me, displayName: "Eu", role: "owner" },
          { userId: dona, displayName: "Dona", role: "member" },
          { userId: bruno, displayName: "Bruno", role: "member" },
          { userId: carla, displayName: "Carla", role: "member" },
          { userId: diego, displayName: "Diego", role: "viewer" },
        ],
      },
    },
  } satisfies Routes;
  const openDialog = async (routes: Routes) => {
    const mock = renderAs("owner", {
      ...list(project({ level: "manage", pendingRequests: 1 })),
      ...members,
      ...routes,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `Gerenciar acesso a ${name}` }));
    const dialog = await screen.findByRole("dialog", { name: "Acesso ao projeto" });
    return { mock, user, dialog };
  };
  const details = accessDetails([
    entry(bruno, "Bruno", "requested"),
    entry(carla, "Carla", "granted", "use"),
  ]);

  it("troca entre restrito e aberto à organização, explicando cada um", async () => {
    const { mock, user, dialog } = await openDialog({
      [`GET ${base}/access`]: { body: details },
      [`PUT ${base}/access/mode`]: { body: accessDetails([], "organization") },
    });

    const restricted = await within(dialog).findByRole("radio", { name: /^Restrito/ });
    expect(restricted).toBeChecked();
    expect(within(dialog).getByText(/Só o dono, os administradores/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Todos os membros abrem o projeto/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Dono: Dona/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("radio", { name: /^Aberto à organização/ }));
    await waitFor(() => expect(called(mock, `PUT ${base}/access/mode`)).toHaveLength(1));
    expect(called(mock, `PUT ${base}/access/mode`)[0]!.body).toEqual({ mode: "organization" });
  });

  it("aprova o pedido escolhendo o nível", async () => {
    const { mock, user, dialog } = await openDialog({
      [`GET ${base}/access`]: { body: details },
      [`PUT ${base}/access/${bruno}`]: { body: details },
    });

    await within(dialog).findByText("Pedidos de acesso");
    await user.selectOptions(within(dialog).getByLabelText("Nível para Bruno"), "edit");
    await user.click(within(dialog).getByRole("button", { name: "Aprovar pedido de Bruno" }));

    await waitFor(() => expect(called(mock, `PUT ${base}/access/${bruno}`)).toHaveLength(1));
    expect(called(mock, `PUT ${base}/access/${bruno}`)[0]!.body).toEqual({
      status: "granted",
      level: "edit",
    });
  });

  it("aprova como 'pode usar' quando o nível não foi mexido, e recusa apagando o pedido", async () => {
    const { mock, user, dialog } = await openDialog({
      [`GET ${base}/access`]: { body: details },
      [`PUT ${base}/access/${bruno}`]: { body: details },
      [`DELETE ${base}/access/${bruno}`]: { status: 204 },
    });

    await user.click(
      await within(dialog).findByRole("button", { name: "Aprovar pedido de Bruno" }),
    );
    await waitFor(() => expect(called(mock, `PUT ${base}/access/${bruno}`)).toHaveLength(1));
    expect(called(mock, `PUT ${base}/access/${bruno}`)[0]!.body).toEqual({
      status: "granted",
      level: "use",
    });

    const refuse = within(dialog).getByRole("button", { name: "Recusar pedido de Bruno" });
    await waitFor(() => expect(refuse).toBeEnabled());
    await user.click(refuse);
    await waitFor(() => expect(called(mock, `DELETE ${base}/access/${bruno}`)).toHaveLength(1));
  });

  it("bloqueia só depois de confirmar, e o bloqueio pode ser cancelado", async () => {
    const { mock, user, dialog } = await openDialog({
      [`GET ${base}/access`]: { body: details },
      [`PUT ${base}/access/${carla}`]: { body: details },
    });

    await user.selectOptions(await within(dialog).findByLabelText("Acesso de Carla"), "blocked");
    const confirm = await screen.findByRole("alertdialog", { name: "Bloquear Carla?" });
    expect(confirm).toHaveAccessibleDescription(
      `Carla fica sem acesso a “${name}” e não poderá pedir acesso de novo, mesmo que o projeto seja aberto à organização. Você pode desbloquear depois.`,
    );
    await user.click(within(confirm).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(called(mock, `PUT ${base}/access/${carla}`)).toHaveLength(0);

    await user.selectOptions(within(dialog).getByLabelText("Acesso de Carla"), "blocked");
    await user.click(
      within(await screen.findByRole("alertdialog", { name: "Bloquear Carla?" })).getByRole(
        "button",
        { name: "Bloquear" },
      ),
    );
    await waitFor(() => expect(called(mock, `PUT ${base}/access/${carla}`)).toHaveLength(1));
    expect(called(mock, `PUT ${base}/access/${carla}`)[0]!.body).toEqual({ status: "blocked" });
  });

  it("muda o nível de quem já foi liberado e tira o acesso", async () => {
    const { mock, user, dialog } = await openDialog({
      [`GET ${base}/access`]: { body: details },
      [`PUT ${base}/access/${carla}`]: { body: details },
      [`DELETE ${base}/access/${carla}`]: { status: 204 },
    });

    const level = await within(dialog).findByLabelText("Acesso de Carla");
    expect(level).toHaveValue("use");
    await user.selectOptions(level, "edit");
    await waitFor(() => expect(called(mock, `PUT ${base}/access/${carla}`)).toHaveLength(1));
    expect(called(mock, `PUT ${base}/access/${carla}`)[0]!.body).toEqual({
      status: "granted",
      level: "edit",
    });

    const take = within(dialog).getByRole("button", { name: "Tirar acesso de Carla" });
    await waitFor(() => expect(take).toBeEnabled());
    await user.click(take);
    await waitFor(() => expect(called(mock, `DELETE ${base}/access/${carla}`)).toHaveLength(1));
  });

  it("adiciona uma pessoa da organização, sem oferecer quem já tem acesso total ou já está na lista", async () => {
    const { mock, user, dialog } = await openDialog({
      [`GET ${base}/access`]: { body: details },
      [`PUT ${base}/access/${diego}`]: { body: details },
    });

    const select = await within(dialog).findByLabelText("Pessoa da organização");
    const offered = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    // Not me (owner), not the project's owner, not Bruno (asked) nor Carla (let in).
    expect(offered).toEqual(["Escolha uma pessoa", "Diego (leitor: só visualiza)"]);
    expect(within(dialog).getByRole("button", { name: "Adicionar pessoa" })).toBeDisabled();

    await user.selectOptions(select, diego);
    await user.selectOptions(within(dialog).getByLabelText("Nível da nova pessoa"), "edit");
    await user.click(within(dialog).getByRole("button", { name: "Adicionar pessoa" }));
    await waitFor(() => expect(called(mock, `PUT ${base}/access/${diego}`)).toHaveLength(1));
    expect(called(mock, `PUT ${base}/access/${diego}`)[0]!.body).toEqual({
      status: "granted",
      level: "edit",
    });
  });

  it("desbloqueia quem estava bloqueado", async () => {
    const { mock, user, dialog } = await openDialog({
      [`GET ${base}/access`]: { body: accessDetails([entry(carla, "Carla", "blocked")]) },
      [`DELETE ${base}/access/${carla}`]: { status: 204 },
    });

    expect(await within(dialog).findByLabelText("Acesso de Carla")).toHaveValue("blocked");
    await user.click(within(dialog).getByRole("button", { name: "Desbloquear Carla" }));
    await waitFor(() => expect(called(mock, `DELETE ${base}/access/${carla}`)).toHaveLength(1));
  });

  it("mostra o motivo quando o servidor recusa a mudança", async () => {
    const { user, dialog } = await openDialog({
      [`GET ${base}/access`]: { body: details },
      [`PUT ${base}/access/${bruno}`]: {
        status: 409,
        body: {
          code: "graph_access_protected",
          message: "O dono do projeto e os administradores da organização já têm acesso total.",
        },
      },
    });

    await user.click(
      await within(dialog).findByRole("button", { name: "Aprovar pedido de Bruno" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("já têm acesso total");
  });
});

describe("quem só usa o projeto", () => {
  const versionId = "5d2a9e84-7c1b-4f30-a6e5-1d8b3c9f2a47";
  const runId = "0b5c7f1e-3a42-4d6b-8e21-9c4d7a6b5e30";
  const definition = {
    schemaVersion: 1,
    id: graphId,
    name: "Um agente",
    nodes: [
      { id: "g", type: "trigger", position: { x: -260, y: 0 }, kind: "manual", target: "a" },
      {
        id: "a",
        type: "agent",
        position: { x: 0, y: 0 },
        name: "Pesquisador",
        role: "r",
        instructions: "i",
        effort: "low",
        runtime: { kind: "terminal", cli: "claude", mode: "pty", args: [], cwd: "C:\\proj" },
      },
    ],
    links: [],
    annotations: [],
  };
  const routes = (latestVersion: number | null): Routes => ({
    [`GET ${base}`]: {
      body: { ...project({ level: "use" }), draft: null, latestVersion },
    },
    [`GET ${base}/versions`]: {
      body: {
        items:
          latestVersion === null
            ? []
            : [{ id: versionId, graphId, version: latestVersion, createdAt: when }],
      },
    },
    [`GET ${base}/versions/1`]: {
      body: { id: versionId, graphId, version: 1, createdAt: when, definition },
    },
  });

  it("abre a versão publicada só para leitura, sem o editor", async () => {
    renderAs("member", routes(1), base);

    const run = await screen.findByRole("button", { name: "Executar" });
    await waitFor(() => expect(run).toBeEnabled());
    expect(await screen.findByRole("region", { name: "Canvas da execução" })).toBeInTheDocument();
    expect(screen.getByText(/O desenho é só para leitura/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Minhas execuções" })).toHaveAttribute("href", "/runs");
    expect(screen.queryByRole("region", { name: "Canvas do grafo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publicar/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Gerenciar acesso a ${name}` }),
    ).not.toBeInTheDocument();
  });

  it("executa a versão publicada e abre a execução", async () => {
    const mock = renderAs(
      "member",
      {
        ...routes(1),
        "POST /runs": { status: 201, body: { id: runId } },
        [`GET /runs/${runId}`]: { status: 500, body: { code: "x", message: "x" } },
      },
      base,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Executar" }));
    const dialog = await screen.findByRole("dialog", { name: "Executar projeto" });
    const start = within(dialog).getByRole("button", { name: "Iniciar execução" });
    expect(start).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Pedido para os agentes"), "Revise o código");
    await user.click(start);

    await waitFor(() => expect(called(mock, "POST /runs")).toHaveLength(1));
    expect(called(mock, "POST /runs")[0]!.body).toEqual({
      graphVersionId: versionId,
      input: "Revise o código",
      triggerId: "g",
    });
  });

  it("sem versão publicada explica o que fazer, sem botão de executar", async () => {
    renderAs("member", routes(null), base);

    expect(
      await screen.findByText("Este projeto ainda não tem versão publicada"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Executar" })).not.toBeInTheDocument();
  });

  it("nos chats, fala com os agentes da versão publicada (o rascunho não chega até quem só usa)", async () => {
    const mock = renderAs(
      "member",
      {
        ...routes(1),
        [`GET ${base}/agent-chats/a/turns`]: { body: { items: [], hasMore: false } },
      },
      `${base}?view=chats`,
    );
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "Pesquisador" })).toBeInTheDocument();
    const message = screen.getByLabelText("Mensagem");
    await user.type(message, "Oi");
    expect(screen.getByRole("button", { name: "Enviar mensagem" })).toBeEnabled();
    expect(called(mock, `GET ${base}/agent-chats/a/turns`).length).toBeGreaterThan(0);
  });
});

describe("quem só pode ver o projeto", () => {
  const definition = {
    schemaVersion: 1,
    id: graphId,
    name: "Um agente",
    nodes: [
      {
        id: "a",
        type: "agent",
        position: { x: 0, y: 0 },
        name: "Pesquisador",
        role: "r",
        instructions: "i",
        effort: "low",
        runtime: { kind: "terminal", cli: "claude", mode: "pty", args: [], cwd: "/work" },
      },
    ],
    links: [],
    annotations: [],
  };

  it("lê os chats, mas não tem onde enviar mensagem", async () => {
    renderAs(
      "viewer",
      {
        [`GET ${base}`]: {
          body: { ...project({ level: "view" }), draft: definition, latestVersion: null },
        },
        [`GET ${base}/versions`]: { body: { items: [] } },
        [`GET ${base}/agent-chats/a/turns`]: { body: { items: [], hasMore: false } },
      },
      `${base}?view=chats`,
    );

    expect(await screen.findByRole("heading", { name: "Pesquisador" })).toBeInTheDocument();
    expect(await screen.findByText(/Você só pode ler este projeto/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Mensagem")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar mensagem" })).not.toBeInTheDocument();
  });
});
