import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "@/live/fixtures/two-terminals-demo.json";
import { FakeSocket } from "@/live/fake-socket";
import { graphId, renderApp, runDetail, runId } from "@/test/helpers";

const versionId = runDetail.graphVersionId;
const agentNode = (id: string, name: string, x: number) => ({
  id,
  type: "agent",
  position: { x, y: 0 },
  name,
  role: "r",
  instructions: "i",
  effort: "low",
  runtime: { kind: "terminal", cli: "claude", mode: "pty", args: [], cwd: "C:\\proj" },
});
const definition = {
  schemaVersion: 1,
  id: graphId,
  name: "Dois terminais",
  nodes: [
    { id: "g", type: "trigger", position: { x: -260, y: 0 }, kind: "manual", target: "a" },
    agentNode("a", "Pesquisador", 0),
    agentNode("b", "Revisor", 300),
  ],
  links: [{ id: "l1", from: "a", to: "b", kind: "talk", bidirectional: true, maxMessages: 10 }],
  annotations: [],
};

const finishedDetail = {
  ...runDetail,
  status: "succeeded" as const,
  finishedAt: "2026-11-04T11:39:48.600Z",
  finish: { seq: 11, reason: "finished", agent: "Pesquisador", result: "resumo validado" },
};
const items = fixture.events.map((event) => ({ runId, ...event }));

const baseRoutes = {
  [`GET /graphs/${graphId}/versions`]: {
    body: {
      items: [{ id: versionId, graphId, version: 3, createdAt: "2026-11-04T10:00:00.000Z" }],
    },
  },
  [`GET /graphs/${graphId}/versions/3`]: {
    body: { id: versionId, graphId, version: 3, createdAt: "2026-11-04T10:00:00.000Z", definition },
  },
};
const replayRoutes = {
  ...baseRoutes,
  [`GET /runs/${runId}`]: { body: finishedDetail },
  [`GET /runs/${runId}/events`]: { body: { items } },
};

const position = () => screen.getByRole("status", { name: "Posição" });
const slider = () => screen.getByRole("slider", { name: "Posição no replay" });
const block = (id: string) => screen.findByTestId(`block-${id}`);
const controls = () => screen.findByRole("region", { name: "Controles do replay" });

beforeEach(() => {
  FakeSocket.reset();
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => vi.unstubAllGlobals());

describe("replay no detalhe da execução", () => {
  it("abre em ?replay=1 sem assinar o /ws, no começo, e avisa do terminal e das esperas", async () => {
    renderApp(`/runs/${runId}?replay=1`, replayRoutes);
    await controls();
    expect(position()).toHaveTextContent("Evento 0 de 11");
    expect(FakeSocket.instances).toHaveLength(0);
    expect(screen.getByText(/O terminal não é reproduzido/)).toBeInTheDocument();
    expect(screen.getByText(/Esperas maiores que 2 s/)).toBeInTheDocument();
    expect(screen.getByText("Nenhuma mensagem até aqui")).toBeInTheDocument();
  });

  it("avança e volta evento a evento: blocos, custo e linha do tempo acompanham o cursor", async () => {
    const user = userEvent.setup();
    renderApp(`/runs/${runId}?replay=1`, replayRoutes);
    await controls();
    const forward = screen.getByRole("button", { name: "Avançar um evento" });
    const back = screen.getByRole("button", { name: "Voltar um evento" });
    expect(back).toBeDisabled();

    for (let i = 0; i < 5; i++) await user.click(forward);
    expect(position()).toHaveTextContent("Evento 5 de 11");
    expect(await block("a")).toHaveAttribute("data-status", "waiting_reply");
    expect(await block("b")).toHaveAttribute("data-status", "starting");
    const timeline = screen.getByRole("region", { name: "Linha do tempo" });
    expect(
      within(timeline)
        .getAllByText(/→/)
        .map((n) => n.textContent),
    ).toEqual(["@trigger → Pesquisador", "Pesquisador → Revisor"]);

    await user.click(back);
    await user.click(back);
    expect(position()).toHaveTextContent("Evento 3 de 11");
    expect(await block("a")).toHaveAttribute("data-status", "starting");
    expect(within(timeline).getAllByText(/→/)).toHaveLength(1);
  });

  it("arrastar a barra leva a qualquer ponto e mostra o custo e o fim ali", async () => {
    renderApp(`/runs/${runId}?replay=1`, replayRoutes);
    await controls();

    fireEvent.change(slider(), { target: { value: "9" } });
    expect(position()).toHaveTextContent("Evento 9 de 11");
    expect(screen.queryByText(/Terminou por/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Total/)).toHaveTextContent("em 0 turnos");

    fireEvent.change(slider(), { target: { value: "10" } });
    expect(screen.getByText(/^Total/)).toHaveTextContent("$0.0123");
    fireEvent.change(slider(), { target: { value: "11" } });
    expect(await screen.findByText(/Terminou por/)).toBeInTheDocument();

    fireEvent.change(slider(), { target: { value: "4" } });
    expect(screen.queryByText(/Terminou por/)).not.toBeInTheDocument();
    expect(await block("a")).toHaveAttribute("data-status", "busy");
  });

  it("no painel do agente, o terminal é trocado por um aviso", async () => {
    renderApp(`/runs/${runId}?replay=1`, replayRoutes);
    await controls();
    fireEvent.change(slider(), { target: { value: "5" } });
    fireEvent.click(await block("a"));
    const panel = await screen.findByRole("region", { name: "Painel do agente Pesquisador" });
    expect(within(panel).getByText(/O terminal não é reproduzido no replay/)).toBeInTheDocument();
    expect(within(panel).queryByText("Terminal")).not.toBeInTheDocument();
  });

  it("os eventos vêm paginados por fromSeq até uma página curta", async () => {
    const many = Array.from({ length: 1500 }, (_, i) => ({
      runId,
      seq: i + 1,
      type: i === 0 ? "RunStarted" : "UsageRecorded",
      agent: i === 0 ? null : "Revisor",
      payload: i === 0 ? { input: "x", budgetUsd: null } : { costUsd: 0.001 },
      at: new Date(Date.UTC(2026, 10, 4, 12, 0, 0, i)).toISOString(),
    }));
    const { calls } = renderApp(`/runs/${runId}?replay=1`, {
      ...replayRoutes,
      [`GET /runs/${runId}/events`]: (request) => {
        const query = new URL(request.url).searchParams;
        const from = Number(query.get("fromSeq"));
        const limit = Number(query.get("limit"));
        return { body: { items: many.filter((e) => e.seq >= from).slice(0, limit) } };
      },
    });
    await controls();
    expect(position()).toHaveTextContent("Evento 0 de 1500");
    expect(calls.filter((c) => c.path === `GET /runs/${runId}/events`)).toHaveLength(2);
    fireEvent.change(slider(), { target: { value: "1500" } });
    await waitFor(() => expect(screen.getByText(/^Total/)).toHaveTextContent("$1.499"));
  });

  it("uma execução em andamento não entra em replay: fica ao vivo, com um aviso", async () => {
    renderApp(`/runs/${runId}?replay=1`, {
      ...baseRoutes,
      [`GET /runs/${runId}`]: { body: runDetail },
    });
    expect(
      await screen.findByText(/replay só existe para execuções terminadas/),
    ).toBeInTheDocument();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(screen.queryByRole("region", { name: "Controles do replay" })).not.toBeInTheDocument();
  });

  it("uma execução terminada tem o botão Replay, que entra e sai do modo", async () => {
    const user = userEvent.setup();
    renderApp(`/runs/${runId}`, replayRoutes);
    await user.click(await screen.findByRole("button", { name: /Replay/ }));
    await controls();
    await user.click(screen.getByRole("button", { name: "Sair do replay" }));
    expect(await screen.findByRole("button", { name: /Replay/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Controles do replay" })).not.toBeInTheDocument();
  });
});
