import mixed from "@neurons/graph-schema/examples/mixed.json";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSocket } from "@/runs/live/fake-socket";
import { graph, graphId, renderApp, runDetail, runId } from "@/test/helpers";

const graphUrl = `/graphs/${graphId}`;
const turnUrl = (agentId: string) => `${graphUrl}/agent-chats/${agentId}/turns`;
const version = {
  id: runDetail.graphVersionId,
  graphId,
  version: 3,
  createdAt: "2026-11-04T10:00:00.000Z",
};
const baseRoutes = {
  [`GET ${graphUrl}`]: { body: { ...graph, draft: mixed } },
  [`GET ${graphUrl}/versions`]: { body: { items: [version] } },
  [`GET ${graphUrl}/versions/3`]: { body: { ...version, definition: mixed } },
  [`GET ${turnUrl("agente-principal")}`]: { body: { items: [], hasMore: false } },
  [`GET ${turnUrl("agente-executor")}`]: { body: { items: [], hasMore: false } },
};

afterEach(() => {
  vi.unstubAllGlobals();
  FakeSocket.reset();
});

describe("Chats do projeto", () => {
  it("recolhe o grafo pelo atalho e volta ao bloco certo sem perder o rascunho", async () => {
    const user = userEvent.setup();
    renderApp(graphUrl, baseRoutes);
    await screen.findByRole("region", { name: "Canvas do grafo" });
    await user.click(screen.getByRole("button", { name: "Ferramenta" }));
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Chats" }));
    const agents = screen.getByRole("navigation", { name: "Agentes do projeto" });
    expect(within(agents).getByRole("link", { name: "Principal" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const toggle = screen.getByRole("button", { name: "Grafo do fluxo" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    const drawer = screen.getByRole("complementary", { name: "Grafo do fluxo" });
    expect(toggle).toHaveAttribute("aria-controls", drawer.id);
    expect(
      within(drawer).getByRole("region", { name: "Canvas do fluxo do chat" }),
    ).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "Fechar grafo" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(within(agents).getByRole("link", { name: "Executor" }));
    expect(screen.getByRole("heading", { name: "Executor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anexar imagem" })).toBeDisabled();
    await user.click(screen.getByRole("link", { name: "Ver no fluxo" }));

    const inspector = screen.getByRole("complementary", { name: "Inspetor" });
    expect(within(inspector).getByLabelText("Nome")).toHaveValue("Executor");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    await user.click(within(inspector).getByRole("link", { name: "Abrir chat" }));
    expect(screen.getByRole("heading", { name: "Executor" })).toBeInTheDocument();
  });

  it("envia uma imagem ao agente certo, anima a entrega e recupera a resposta persistida", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const user = userEvent.setup();
    const url = turnUrl("agente-principal");
    const reply = "Analisei a imagem enviada.";
    let accepted = false;
    let finished = false;
    const { calls } = renderApp(`${graphUrl}?view=chats&agent=agente-principal`, {
      ...baseRoutes,
      [`GET ${url}`]: () => ({
        body: {
          items: accepted
            ? [
                {
                  runId,
                  graphVersionId: version.id,
                  status: finished ? "succeeded" : "running",
                  input: "",
                  imageName: "referencia.png",
                  replies: finished ? [{ id: "resposta", text: reply }] : [],
                  error: null,
                },
              ]
            : [],
          hasMore: false,
        },
      }),
      [`POST ${url}`]: () => {
        accepted = true;
        return { status: 201, body: { runId } };
      },
    });
    await screen.findByText("Envie uma mensagem para começar.");
    await user.click(screen.getByRole("button", { name: "Grafo do fluxo" }));
    await user.upload(
      screen.getByLabelText("Selecionar imagem"),
      new File(["amostra"], "referencia.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "POST",
        path: `POST ${url}`,
        body: {
          body: "",
          image: { name: "referencia.png", mediaType: "image/png", base64: "YW1vc3RyYQ==" },
        },
      }),
    );

    const drawer = screen.getByRole("complementary", { name: "Grafo do fluxo" });
    expect(await within(drawer).findByText("Em execução")).toBeInTheDocument();
    const block = await within(drawer).findByTestId("block-agente-principal");
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.last;
    const event = (seq: number, type: string, agent: string | null, payload: unknown) =>
      socket.push("run.event", { runId, seq, type, agent, payload, at: new Date().toISOString() });

    act(() => {
      socket.open();
      socket.push("subscribed", { runId });
      event(1, "RunStarted", null, { input: "" });
      event(2, "MessageSent", "@human", {
        messageId: "mensagem",
        from: "@human",
        to: "Principal",
        kind: "message",
        body: "",
      });
      event(3, "AgentStateChanged", "Principal", { state: "busy" });
    });
    await waitFor(() => expect(block).toHaveAttribute("data-receiving", "true"));
    expect(block).toHaveAttribute("data-status", "busy");

    act(() =>
      socket.push("run.ephemeral", {
        runId,
        type: "AgentOutputDelta",
        agent: "Principal",
        channel: "text",
        turnId: "turno",
        delta: reply,
      }),
    );
    expect(await screen.findByText(reply)).toBeInTheDocument();

    finished = true;
    act(() => event(4, "RunFinished", "Principal", { reason: "finished" }));
    await waitFor(() => expect(within(drawer).queryByText("Em execução")).not.toBeInTheDocument());
    expect(screen.getAllByText(reply)).toHaveLength(1);
    expect(
      within(screen.getByRole("log", { name: "Conversa" })).getByText("referencia.png"),
    ).toBeInTheDocument();
  });
});
