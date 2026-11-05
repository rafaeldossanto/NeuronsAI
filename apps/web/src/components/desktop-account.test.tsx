import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopAccount, type DesktopAccountBridge } from "./desktop-account";
import { SessionGate } from "@/auth/session-gate";
import { mockFetch } from "@/test/helpers";
import { createApi } from "@/lib/api";

function bridge(remote = false): DesktopAccountBridge {
  return {
    getState: vi.fn<DesktopAccountBridge["getState"]>(() =>
      Promise.resolve({
        mode: remote ? "remote" : "local",
        serverOrigin: remote ? "https://neurons.example.invalid" : null,
      }),
    ),
    connect: vi.fn(() => Promise.resolve()),
    signIn: vi.fn(() => Promise.resolve()),
    cancelLogin: vi.fn(() => Promise.resolve()),
    openLocal: vi.fn(() => Promise.resolve()),
    forget: vi.fn(() => Promise.resolve()),
  };
}
afterEach(() => {
  delete window.neuronsDesktop;
});
describe("servidor no app desktop", () => {
  it("configura o servidor por ação nativa e mantém falhas no formulário", async () => {
    const user = userEvent.setup(),
      account = bridge();
    vi.mocked(account.connect).mockRejectedValue(
      new Error("O servidor precisa de login configurado."),
    );
    render(<DesktopAccount account={account} />);
    await user.click(await screen.findByRole("button", { name: "Conectar servidor" }));
    await user.type(
      screen.getByLabelText("Endereço do servidor"),
      "https://neurons.example.invalid",
    );
    await user.click(screen.getByRole("button", { name: "Abrir servidor" }));
    expect(account.connect).toHaveBeenCalledWith("https://neurons.example.invalid");
    expect(await screen.findByRole("alert")).toHaveTextContent("login configurado");
  });
  it("permite voltar ao workspace local mesmo quando a tela remota não tem sessão", async () => {
    const user = userEvent.setup(),
      account = bridge(true);
    render(<DesktopAccount account={account} />);
    await user.click(await screen.findByRole("button", { name: "Voltar ao local" }));
    expect(account.openLocal).toHaveBeenCalledOnce();
  });
  it("delega Google ao main, mostra espera e cancela sem iniciar login na janela embutida", async () => {
    const user = userEvent.setup(),
      account = bridge(true);
    let reject!: (error: Error) => void;
    vi.mocked(account.signIn).mockReturnValue(
      new Promise((_resolve, refuse) => {
        reject = refuse;
      }),
    );
    vi.mocked(account.cancelLogin).mockImplementation(() => {
      reject(new Error("Entrada cancelada."));
      return Promise.resolve();
    });
    Object.defineProperty(window, "neuronsDesktop", { configurable: true, value: { account } });
    const mock = mockFetch({
      "GET /auth/session": { status: 403, body: { code: "invalid_session" } },
    });
    const navigate = vi.fn();
    render(
      <SessionGate api={createApi(mock.fetch)} navigate={navigate}>
        <p>Privado</p>
      </SessionGate>,
    );
    await user.click(await screen.findByRole("button", { name: "Entrar com Google" }));
    expect(screen.getByRole("button", { name: "Conclua a entrada no navegador…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancelar entrada" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cancelada");
    expect(account.signIn).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(mock.calls.some((call) => call.path === "POST /auth/google")).toBe(false);
  });
});
