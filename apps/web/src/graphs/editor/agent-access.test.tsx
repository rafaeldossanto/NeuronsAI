import type { AgentNode } from "@neurons/graph-schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createQueryClient } from "@/app";
import { ApiProvider, createApi } from "@/shared/api";
import { mockFetch } from "@/test/helpers";
import { WorkspaceProvider } from "@/workspace/resources";
import { AgentAccess } from "./agent-access";

const agent = (runtime: Record<string, unknown>) =>
  ({
    id: "a",
    type: "agent",
    position: { x: 0, y: 0 },
    name: "Dev",
    role: "",
    instructions: "",
    effort: "low",
    runtime,
  }) as unknown as AgentNode;

const terminal = (cli: string, extra: Record<string, unknown> = {}) =>
  agent({ kind: "terminal", cli, mode: "stream-json", args: [], cwd: "C:\\Projeto", ...extra });

function renderAccess(node: AgentNode) {
  const mocked = mockFetch({
    "GET /secrets": { body: { names: [] } },
    "GET /connections": {
      body: {
        profile: "local",
        secretsEnabled: true,
        claude: { installed: true, connected: true, signingIn: false, message: "Claude ok." },
        chatgpt: {
          available: true,
          installed: true,
          connected: false,
          signingIn: false,
          message: "Conecte sua conta.",
        },
      },
    },
  });
  render(
    <ApiProvider api={createApi(mocked.fetch)}>
      <QueryClientProvider client={createQueryClient()}>
        <WorkspaceProvider>
          <AgentAccess node={node} set={() => undefined} />
        </WorkspaceProvider>
      </QueryClientProvider>
    </ApiProvider>,
  );
}

describe("acesso à IA do agente de terminal", () => {
  it("Codex aceita assinatura e mostra a conexão da conta do ChatGPT", async () => {
    renderAccess(terminal("codex"));
    expect(screen.getByRole("button", { name: "Assinatura" })).toBeEnabled();
    expect(await screen.findByRole("button", { name: "Conectar ChatGPT" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Conectar Claude Code" })).not.toBeInTheDocument();
  });

  it("Claude Code continua mostrando a própria conexão", async () => {
    renderAccess(terminal("claude"));
    expect(await screen.findByRole("button", { name: "Claude Code conectado" })).toBeDisabled();
  });

  it("Gemini ainda não tem assinatura", () => {
    renderAccess(terminal("gemini"));
    expect(screen.getByRole("button", { name: "Assinatura" })).toBeDisabled();
  });

  it("Codex com chave de API no modo terminal avisa que só o stream-json aceita", () => {
    renderAccess(terminal("codex", { mode: "pty", access: "api-key" }));
    expect(screen.getByText(/só aceita chave de API no modo stream-json/)).toBeInTheDocument();
  });
});
