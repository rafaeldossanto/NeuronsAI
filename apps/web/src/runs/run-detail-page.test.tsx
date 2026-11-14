import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket } from "@/runs/live/fake-socket";
import { renderApp, runDetail, runId } from "@/test/helpers";

const frame = (seq: number, type: string, agent: string | null, payload: unknown) => ({
  runId,
  seq,
  type,
  agent,
  payload,
  at: "2026-11-02T12:00:01.000Z",
});

const sent = (seq: number, from: string, to: string, kind: string, body: string) =>
  frame(seq, "MessageSent", from, { messageId: `m${seq}`, from, to, kind, replyTo: null, body });

const detailRoute = { [`GET /runs/${runId}`]: { body: runDetail } };

async function openSocket() {
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  const socket = FakeSocket.last;
  act(() => {
    socket.open();
    socket.push("subscribed", { runId });
  });
  return socket;
}

beforeEach(() => {
  FakeSocket.reset();
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => vi.unstubAllGlobals());

describe("detalhe da execução ao vivo", () => {
  it("assina o /ws desde o começo e mostra a conexão", async () => {
    renderApp(`/runs/${runId}`, detailRoute);
    const socket = await openSocket();

    expect(socket.url).toMatch(/\/ws$/);
    expect(socket.sent[0]).toEqual({ event: "subscribe", data: { runId, fromSeq: 1 } });
    expect(await screen.findByRole("status", { name: "Conexão" })).toHaveTextContent("Ao vivo");
  });

  it("atualiza status, agentes, custo e linha do tempo conforme os eventos chegam", async () => {
    renderApp(`/runs/${runId}`, detailRoute);
    const socket = await openSocket();

    act(() => {
      socket.push(
        "run.event",
        frame(1, "RunStarted", null, { input: "Revise o PR 42", budgetUsd: null }),
      );
      socket.push("run.event", frame(2, "AgentStarted", "Pesquisador", { briefing: "x" }));
      socket.push("run.event", sent(3, "Pesquisador", "Revisor", "ask", "o resumo está certo?"));
      socket.push("run.event", frame(4, "UsageRecorded", "Revisor", { costUsd: 0.5 }));
      socket.push("run.event", frame(5, "UsageRecorded", "Pesquisador", { costUsd: null }));
    });

    expect(await screen.findByText("Pesquisador → Revisor")).toBeInTheDocument();
    expect(screen.getByText("o resumo está certo?")).toBeInTheDocument();
    expect(screen.getByText("pergunta")).toBeInTheDocument();
    expect(screen.getByText(/Esperando resposta · custo desconhecido/)).toBeInTheDocument();
    expect(screen.getByText(/Subindo · \$0\.50 /)).toBeInTheDocument();
    expect(screen.getByText("$0.50")).toBeInTheDocument();
    expect(screen.getByText(/1 sem custo informado/)).toBeInTheDocument();
  });

  it("mostra o fim da execução e esconde parar e mensagem", async () => {
    renderApp(`/runs/${runId}`, {
      ...detailRoute,
    });
    const socket = await openSocket();
    expect(await screen.findByRole("button", { name: "Parar" })).toBeInTheDocument();

    act(() => {
      socket.push("run.event", frame(1, "RunStarted", null, { input: "x", budgetUsd: null }));
      socket.push(
        "run.event",
        frame(2, "RunFinished", "Pesquisador", { reason: "finished", result: "pronto" }),
      );
    });

    expect(await screen.findByText("Concluída")).toBeInTheDocument();
    expect(screen.getByText(/Terminou por/)).toHaveTextContent("conclusão pelo agente: pronto");
    expect(screen.queryByRole("button", { name: "Parar" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Conexão" })).toHaveTextContent("Encerrada");
  });

  it("acompanha leituras e alterações de memória, sem repetir eventos nem exibir o conteúdo da nota", async () => {
    renderApp(`/runs/${runId}`, detailRoute);
    const socket = await openSocket();
    const call = frame(1, "ToolCalled", "Pesquisador", {
      tool: "obsidian_create",
      inputSummary:
        '{"nodeId":"memoria","path":"Projeto/Decisões.md","content":"conteúdo privado"}',
      durationMs: 12,
      ok: true,
    });
    act(() => {
      socket.push("run.event", call);
      socket.push("run.event", call);
      socket.push(
        "run.event",
        frame(2, "ToolCalled", "Pesquisador", {
          tool: "obsidian_edit",
          inputSummary: '{"path":"Projeto/Decisões.md"}',
          durationMs: 3,
          ok: false,
          errorCode: "CONFLICT",
        }),
      );
    });
    // The socket's messages reach the screen in one batch per animation frame.
    expect(await screen.findByText("Editar nota")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Linha do tempo" })).toBeInTheDocument();
    expect(screen.getAllByText("Criar nota")).toHaveLength(1);
    expect(screen.getByText("CONFLICT")).toBeInTheDocument();
    expect(screen.queryByText(/conteúdo privado/)).not.toBeInTheDocument();
  });

  it("para a execução", async () => {
    const { calls } = renderApp(`/runs/${runId}`, {
      ...detailRoute,
      [`POST /runs/${runId}/stop`]: { body: {} },
    });
    await openSocket();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Parar" }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === `POST /runs/${runId}/stop`)).toBe(true),
    );
  });

  it("manda uma mensagem como @human e limpa o campo", async () => {
    const { calls } = renderApp(`/runs/${runId}`, {
      ...detailRoute,
      [`POST /runs/${runId}/messages`]: { status: 201, body: {} },
    });
    await openSocket();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Para o agente"), "Revisor");
    const message = screen.getByLabelText("Mensagem");
    await user.type(message, "olá");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() =>
      expect(calls.find((c) => c.path === `POST /runs/${runId}/messages`)?.body).toEqual({
        to: "Revisor",
        body: "olá",
      }),
    );
    await waitFor(() => expect(message).toHaveValue(""));
  });

  it("mostra o erro do servidor ao mandar a mensagem", async () => {
    renderApp(`/runs/${runId}`, {
      ...detailRoute,
      [`POST /runs/${runId}/messages`]: {
        status: 400,
        body: { code: "unknown_recipient", message: "Agente desconhecido." },
      },
    });
    await openSocket();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Para o agente"), "Ninguém");
    await user.type(screen.getByLabelText("Mensagem"), "oi");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Agente desconhecido.");
  });

  it("mostra o aviso de guarda", async () => {
    renderApp(`/runs/${runId}`, detailRoute);
    const socket = await openSocket();
    act(() => {
      socket.push(
        "run.event",
        frame(1, "GuardTripped", null, {
          guard: "run_budget",
          scope: "run",
          reason: "Orçamento estourou.",
        }),
      );
    });
    expect(await screen.findByText(/Orçamento estourou\./)).toBeInTheDocument();
  });

  it("mostra o erro quando a execução não existe", async () => {
    const notFound = {
      status: 404,
      body: { code: "run_not_found", message: "Execução não encontrada." },
    };
    renderApp(`/runs/${runId}`, { [`GET /runs/${runId}`]: notFound });
    expect(await screen.findByRole("alert")).toHaveTextContent("Execução não encontrada.");
  });
});
