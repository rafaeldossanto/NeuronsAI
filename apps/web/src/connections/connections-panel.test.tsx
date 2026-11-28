import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createQueryClient } from "@/app";
import { ApiProvider, createApi } from "@/shared/api";
import { mockFetch } from "@/test/helpers";
import { WorkspaceProvider } from "@/workspace/resources";
import { ConnectionsPanel } from "./connections-panel";

const connections = (chatgpt: { installed: boolean; connected: boolean; message: string }) => ({
  body: {
    profile: "local",
    secretsEnabled: true,
    claude: { installed: true, connected: true, signingIn: false, message: "Claude conectado." },
    chatgpt: { available: true, signingIn: false, ...chatgpt },
  },
});

function renderPanel(routes: Parameters<typeof mockFetch>[0]) {
  const mocked = mockFetch({ "GET /secrets": { body: { names: [] } }, ...routes });
  render(
    <ApiProvider api={createApi(mocked.fetch)}>
      <QueryClientProvider client={createQueryClient()}>
        <WorkspaceProvider>
          <ConnectionsPanel onClose={() => undefined} />
        </WorkspaceProvider>
      </QueryClientProvider>
    </ApiProvider>,
  );
  return mocked;
}

describe("conexões de IA: ChatGPT", () => {
  it("não aparece mais como “Em breve”: mostra o status do Codex e o botão de conectar", async () => {
    renderPanel({
      "GET /connections": connections({
        installed: true,
        connected: false,
        message: "Conecte sua conta pelo login oficial do Codex (Sign in with ChatGPT).",
      }),
    });
    const dialog = await screen.findByRole("dialog", { name: "Conexões de IA" });
    expect(within(dialog).queryByText("Em breve")).not.toBeInTheDocument();
    expect(await within(dialog).findByText(/login oficial do Codex/)).toBeInTheDocument();
    expect(within(dialog).getByText(/npm i -g @openai\/codex/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Conectar ChatGPT" })).toBeEnabled();
  });

  it("abre o login oficial do Codex ao conectar", async () => {
    const mocked = renderPanel({
      "GET /connections": connections({
        installed: true,
        connected: false,
        message: "Conecte sua conta.",
      }),
      "POST /connections/chatgpt/login": { body: { started: true } },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Conectar ChatGPT" }));
    await waitFor(() =>
      expect(mocked.calls.some((call) => call.path === "POST /connections/chatgpt/login")).toBe(
        true,
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/página oficial/);
    expect(mocked.calls.some((call) => call.path === "POST /connections/claude/login")).toBe(false);
  });

  it("sem o Codex instalado, o botão fica desligado e a mensagem manda instalar", async () => {
    renderPanel({
      "GET /connections": connections({
        installed: false,
        connected: false,
        message: "Instale o app do Codex ou o Codex CLI (npm i -g @openai/codex) neste computador.",
      }),
    });
    expect(await screen.findByText(/Instale o app do Codex/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conectar ChatGPT" })).toBeDisabled();
  });

  it("com a conta conectada, mostra o botão como conectado", async () => {
    renderPanel({
      "GET /connections": connections({
        installed: true,
        connected: true,
        message: "Codex conectado à sua conta do ChatGPT neste computador.",
      }),
    });
    expect(await screen.findByRole("button", { name: "ChatGPT conectado" })).toBeDisabled();
  });
});

describe("conexões de IA: Verificar conexão", () => {
  const ok = { installed: true, connected: true, message: "Codex conectado." };
  const off = { installed: true, connected: false, message: "Conecte sua conta." };
  const indicators = (card: string) =>
    within(screen.getByRole("heading", { name: card }).closest("section")!).queryByTestId(
      "connection-check",
    );

  it("não mostra indicador antes do primeiro clique", async () => {
    renderPanel({ "GET /connections": connections(ok) });
    await screen.findByRole("button", { name: "ChatGPT conectado" });
    expect(screen.queryByTestId("connection-check")).not.toBeInTheDocument();
  });

  it("mostra o loader e desliga o botão enquanto verifica, depois o check verde", async () => {
    renderPanel({ "GET /connections": connections(ok) });
    await screen.findByRole("button", { name: "ChatGPT conectado" });
    const [, button] = screen.getAllByRole("button", { name: "Verificar conexão" });
    await userEvent.click(button!);
    const indicator = indicators("ChatGPT (Codex)")!;
    expect(indicator).toHaveAttribute("data-state", "checking");
    expect(indicator).toHaveAccessibleName("Verificando conexão…");
    expect(button).toBeDisabled();
    await waitFor(() => expect(indicator).toHaveAttribute("data-state", "ok"));
    expect(indicator).toHaveAccessibleName("Conexão confirmada");
    expect(button).toBeEnabled();
  });

  it("mostra o X vermelho quando o provedor não está conectado e não mexe no outro card", async () => {
    renderPanel({ "GET /connections": connections(off) });
    await screen.findByRole("button", { name: "Conectar ChatGPT" });
    const [, button] = screen.getAllByRole("button", { name: "Verificar conexão" });
    await userEvent.click(button!);
    await waitFor(() =>
      expect(indicators("ChatGPT (Codex)")).toHaveAttribute("data-state", "fail"),
    );
    expect(indicators("ChatGPT (Codex)")).toHaveAccessibleName("Não conectado");
    expect(indicators("Claude Code")).not.toBeInTheDocument();
  });

  it("mostra o X vermelho quando a consulta falha", async () => {
    let calls = 0;
    renderPanel({
      "GET /connections": () => {
        calls += 1;
        return calls === 1
          ? connections(ok)
          : { status: 500, body: { code: "boom", message: "Falhou." } };
      },
    });
    await screen.findByRole("button", { name: "ChatGPT conectado" });
    const [first] = screen.getAllByRole("button", { name: "Verificar conexão" });
    await userEvent.click(first!);
    await waitFor(() => expect(indicators("Claude Code")).toHaveAttribute("data-state", "fail"));
    expect(indicators("ChatGPT (Codex)")).not.toBeInTheDocument();
  });
});
