import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "@/lib/api";
import { mockFetch } from "@/test/helpers";
import { SessionGate } from "./session-gate";

describe("entrada no espaço", () => {
  it("abre o workspace local sem exigir conta", async () => {
    const mock = mockFetch({
      "GET /auth/session": { body: { enabled: false, authenticated: false } },
    });
    render(
      <SessionGate api={createApi(mock.fetch)}>
        <p>Workspace local</p>
      </SessionGate>,
    );
    expect(await screen.findByText("Workspace local")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Entrar com Google" })).not.toBeInTheDocument();
  });
  it("oculta os projetos sem sessão e inicia somente o login oficial", async () => {
    const mock = mockFetch({
      "GET /auth/session": {
        status: 403,
        body: { code: "invalid_session", message: "Entre novamente." },
      },
      "POST /auth/google": {
        body: { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=test" },
      },
    });
    const navigate = vi.fn();
    render(
      <SessionGate api={createApi(mock.fetch)} navigate={navigate}>
        <p>Projetos privados</p>
      </SessionGate>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Entrar com Google" }));
    expect(navigate).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth?state=test",
    );
    expect(screen.queryByText("Projetos privados")).not.toBeInTheDocument();
  });
  it("mostra falha de rede com nova tentativa e não libera o workspace", async () => {
    const mock = mockFetch({
      "GET /auth/session": {
        status: 503,
        body: { code: "unavailable", message: "Servidor indisponível." },
      },
    });
    render(
      <SessionGate api={createApi(mock.fetch)}>
        <p>Privado</p>
      </SessionGate>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Servidor indisponível");
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
    expect(screen.queryByText("Privado")).not.toBeInTheDocument();
  });
  it("recusa um endereço de login externo diferente do Google", async () => {
    const mock = mockFetch({
      "GET /auth/session": { status: 403, body: { code: "invalid_session" } },
      "POST /auth/google": { body: { authorizationUrl: "https://other.invalid" } },
    });
    const navigate = vi.fn();
    render(
      <SessionGate api={createApi(mock.fetch)} navigate={navigate}>
        <p>Privado</p>
      </SessionGate>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Entrar com Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("endereço de login inválido");
    expect(navigate).not.toHaveBeenCalled();
  });
});
