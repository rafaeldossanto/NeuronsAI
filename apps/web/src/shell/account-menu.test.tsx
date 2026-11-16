import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { App } from "@/app";
import { createApi } from "@/shared/api";
import { mockFetch } from "@/test/helpers";
import { SessionGate } from "@/accounts/auth/session-gate";
import { DesktopAccount, type DesktopAccountBridge } from "@/accounts/desktop-account";

afterEach(() => vi.unstubAllGlobals());

function setup(authenticated = false, logoutStatus = 204) {
  const mock = mockFetch({
    "GET /auth/session": {
      body: {
        enabled: authenticated,
        authenticated,
        userId: "user",
        organizationId: "org",
        role: "owner",
      },
    },
    "GET /auth/organizations": {
      body: { items: [{ id: "org", name: "Equipe local", role: "owner" }] },
    },
    "GET /graphs": { body: { items: [] } },
    "GET /memories": { body: { items: [] } },
    "GET /secrets": { body: { names: [] } },
    "GET /connections": {
      body: {
        profile: "local",
        secretsEnabled: true,
        claude: { installed: false, connected: false, message: "Claude Code não instalado" },
        chatgpt: { message: "Em breve" },
      },
    },
    "POST /auth/logout": { status: logoutStatus },
  });
  const api = createApi(mock.fetch);
  const account: DesktopAccountBridge = {
    getState: vi.fn<DesktopAccountBridge["getState"]>(() =>
      Promise.resolve({ mode: "local", serverOrigin: null }),
    ),
    connect: vi.fn(async () => {}),
    signIn: vi.fn(async () => {}),
    cancelLogin: vi.fn(async () => {}),
    openLocal: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
  };
  render(
    <MemoryRouter initialEntries={["/graphs"]}>
      <DesktopAccount account={account}>
        <SessionGate api={api}>
          <App api={api} />
        </SessionGate>
      </DesktopAccount>
    </MemoryRouter>,
  );
  return { mock, account, user: userEvent.setup() };
}

describe("menu compacto da conta", () => {
  it("reúne servidor e chaves sem uma faixa extra e abre o painel existente", async () => {
    const { user } = setup();
    const trigger = await screen.findByRole("button", { name: "Abrir menu da conta" });
    expect(screen.queryByRole("button", { name: "Conectar servidor" })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation", { name: "Principal" })).getAllByRole("link"),
    ).toHaveLength(2);
    await user.click(trigger);
    const menu = screen.getByRole("dialog", { name: "Conta e conexões" });
    expect(within(menu).getByText("Conta local")).toBeInTheDocument();
    expect(within(menu).queryByText("Sair da conta")).not.toBeInTheDocument();
    await user.click(within(menu).getByRole("button", { name: "Chaves de API" }));
    expect(screen.queryByRole("dialog", { name: "Conta e conexões" })).not.toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "Conexões de IA" })).toBeInTheDocument();
    expect(screen.getByLabelText("Chave de API")).toBeInTheDocument();
  });

  it("abre o formulário nativo de servidor pelo menu", async () => {
    const { user, account } = setup();
    await user.click(await screen.findByRole("button", { name: "Abrir menu da conta" }));
    await user.click(screen.getByRole("button", { name: "Conectar servidor" }));
    await user.type(
      screen.getByLabelText("Endereço do servidor"),
      "https://neurons.example.invalid",
    );
    await user.click(screen.getByRole("button", { name: "Abrir servidor" }));
    expect(account.connect).toHaveBeenCalledWith("https://neurons.example.invalid");
  });

  it("funciona pelo teclado e fecha com Escape ou clique fora", async () => {
    const { user } = setup();
    const trigger = await screen.findByRole("button", { name: "Abrir menu da conta" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Conexões de IA" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    await user.click(screen.getByRole("link", { name: "Meus projetos" }));
    expect(screen.queryByRole("dialog", { name: "Conta e conexões" })).not.toBeInTheDocument();
  });

  it("mantém organizações, runners e saída da sessão dentro da conta", async () => {
    const { user, mock } = setup(true);
    await user.click(await screen.findByRole("button", { name: "Abrir menu da conta" }));
    expect(await screen.findByText("Equipe local")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Organizações" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Runners" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sair da conta" }));
    expect(await screen.findByRole("button", { name: "Entrar com Google" })).toBeInTheDocument();
    expect(mock.calls.some((call) => call.path === "POST /auth/logout")).toBe(true);
  });

  it("mantém a conta acessível quando a saída falha", async () => {
    const { user } = setup(true, 503);
    await user.click(await screen.findByRole("button", { name: "Abrir menu da conta" }));
    await user.click(screen.getByRole("button", { name: "Sair da conta" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível encerrar a sessão"),
    );
    expect(screen.getByRole("button", { name: "Sair da conta" })).toBeEnabled();
  });

  it("preserva o retorno ao local quando a sessão remota expirou", async () => {
    const user = userEvent.setup();
    const mock = mockFetch({
      "GET /auth/session": { status: 403, body: { code: "invalid_session" } },
    });
    const account: DesktopAccountBridge = {
      getState: vi.fn<DesktopAccountBridge["getState"]>(() =>
        Promise.resolve({ mode: "remote", serverOrigin: "https://neurons.example.invalid" }),
      ),
      connect: vi.fn<DesktopAccountBridge["connect"]>(() => Promise.resolve()),
      signIn: vi.fn<DesktopAccountBridge["signIn"]>(() => Promise.resolve()),
      cancelLogin: vi.fn<DesktopAccountBridge["cancelLogin"]>(() => Promise.resolve()),
      openLocal: vi.fn<DesktopAccountBridge["openLocal"]>(() => Promise.resolve()),
      forget: vi.fn<DesktopAccountBridge["forget"]>(() => Promise.resolve()),
    };
    render(
      <DesktopAccount account={account}>
        <SessionGate api={createApi(mock.fetch)}>
          <p>Projetos privados</p>
        </SessionGate>
      </DesktopAccount>,
    );
    await screen.findByRole("button", { name: "Entrar com Google" });
    expect(screen.queryByText("Projetos privados")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Voltar ao local" }));
    expect(account.openLocal).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Conectar servidor" }));
    expect(screen.getByLabelText("Endereço do servidor")).toHaveValue(
      "https://neurons.example.invalid",
    );
  });
});
