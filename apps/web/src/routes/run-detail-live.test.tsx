import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket } from "@/live/fake-socket";
import { graphId, renderApp, runDetail, runId } from "@/test/helpers";

// xterm.js needs a real layout engine; the panel only talks to it through this small surface.
const fake = vi.hoisted(() => {
  class FakeTerminal {
    static instances: FakeTerminal[] = [];
    writes: string[] = [];
    resets = 0;
    options: Record<string, unknown> = {};
    handler: ((data: string) => void) | null = null;
    cols: number;
    rows: number;
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      this.cols = options["cols"] as number;
      this.rows = options["rows"] as number;
      FakeTerminal.instances.push(this);
    }
    loadAddon() {}
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
    }
    open() {}
    write(data: string) {
      this.writes.push(data);
    }
    reset() {
      this.resets += 1;
      this.writes = [];
    }
    onData(handler: (data: string) => void) {
      this.handler = handler;
      return { dispose: () => (this.handler = null) };
    }
    dispose() {}
    type(data: string) {
      this.handler?.(data);
    }
  }
  /** What the box can show of the terminal: measured by the fit addon, which needs a layout engine. */
  const box = { dimensions: { cols: 90, rows: 30 } as { cols: number; rows: number } | undefined };
  class FakeFitAddon {
    proposeDimensions() {
      return box.dimensions;
    }
  }
  /** The browser tells the panel its box changed through this. */
  const observers: ((entries: unknown[]) => void)[] = [];
  class FakeResizeObserver {
    constructor(callback: (entries: unknown[]) => void) {
      observers.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  return { FakeTerminal, FakeFitAddon, FakeResizeObserver, box, observers };
});
vi.mock("@xterm/xterm", () => ({ Terminal: fake.FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: fake.FakeFitAddon }));

const versionId = runDetail.graphVersionId;
const agentNode = (id: string, name: string, x: number, mode: "pty" | "stream-json") => ({
  id,
  type: "agent",
  position: { x, y: 0 },
  name,
  role: "r",
  instructions: "i",
  effort: "low",
  runtime: { kind: "terminal", cli: "claude", mode, args: [], cwd: "C:\\proj" },
});
const definition = {
  schemaVersion: 1,
  id: graphId,
  name: "Dois terminais",
  nodes: [
    { id: "g", type: "trigger", position: { x: -260, y: 0 }, kind: "manual", target: "a" },
    agentNode("a", "Pesquisador", 0, "pty"),
    agentNode("b", "Revisor", 300, "stream-json"),
  ],
  links: [{ id: "l1", from: "a", to: "b", kind: "talk", bidirectional: true, maxMessages: 10 }],
  annotations: [],
};

const routes = {
  [`GET /runs/${runId}`]: { body: runDetail },
  [`GET /graphs/${graphId}/versions`]: {
    body: {
      items: [{ id: versionId, graphId, version: 3, createdAt: "2026-11-04T10:00:00.000Z" }],
    },
  },
  [`GET /graphs/${graphId}/versions/3`]: {
    body: { id: versionId, graphId, version: 3, createdAt: "2026-11-04T10:00:00.000Z", definition },
  },
};

const frame = (seq: number, type: string, agent: string | null, payload: unknown) => ({
  runId,
  seq,
  type,
  agent,
  payload,
  at: new Date().toISOString(),
});
const state = (seq: number, agent: string, value: string) =>
  frame(seq, "AgentStateChanged", agent, { state: value });
const terminal = (data: string, replay = false) => ({
  runId,
  type: "TerminalOutput",
  agent: "Pesquisador",
  data,
  replay,
});

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
  fake.FakeTerminal.instances = [];
  fake.observers.length = 0;
  fake.box.dimensions = { cols: 90, rows: 30 };
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("ResizeObserver", fake.FakeResizeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("execução ao vivo sobre o desenho", () => {
  it("mostra o estado e o custo de cada agente no bloco", async () => {
    renderApp(`/runs/${runId}`, routes);
    const socket = await openSocket();
    act(() => {
      socket.push("run.event", frame(1, "RunStarted", null, { input: "x", budgetUsd: null }));
      socket.push("run.event", state(2, "Pesquisador", "starting"));
      socket.push("run.event", state(3, "Revisor", "waiting_reply"));
      socket.push("run.event", frame(4, "UsageRecorded", "Revisor", { costUsd: 0.25 }));
      socket.push("run.event", state(5, "Pesquisador", "busy"));
    });

    const researcher = await screen.findByTestId("block-a");
    await waitFor(() => expect(researcher).toHaveAttribute("data-status", "busy"));
    expect(within(researcher).getByText("Ocupado")).toBeInTheDocument();
    expect(within(researcher).getByText("custo desconhecido")).toBeInTheDocument();
    const reviewer = screen.getByTestId("block-b");
    expect(reviewer).toHaveAttribute("data-status", "waiting_reply");
    expect(within(reviewer).getByText("$0.25")).toBeInTheDocument();
    expect(screen.getByTestId("block-g")).not.toHaveAttribute("data-status");
  });
});

describe("painel do agente", () => {
  async function openPanel() {
    renderApp(`/runs/${runId}`, routes);
    const socket = await openSocket();
    act(() => {
      socket.push("run.event", frame(1, "RunStarted", null, { input: "x", budgetUsd: null }));
      socket.push("run.event", state(2, "Pesquisador", "busy"));
    });
    fireEvent.click(await screen.findByTestId("block-a"));
    await screen.findByRole("region", { name: "Painel do agente Pesquisador" });
    await waitFor(() => expect(fake.FakeTerminal.instances).toHaveLength(1));
    return { socket, term: fake.FakeTerminal.instances[0]! };
  }

  it("mostra a saída ao vivo e troca a tela pelo resumo da reconexão em vez de somar", async () => {
    const { socket, term } = await openPanel();

    act(() => socket.push("run.ephemeral", terminal("olá ")));
    act(() => socket.push("run.ephemeral", terminal("mundo")));
    await waitFor(() => expect(term.writes.join("")).toBe("olá mundo"));
    expect(term.resets).toBe(1); // only the first draw

    act(() => socket.push("run.ephemeral", terminal("tela refeita", true)));
    await waitFor(() => expect(term.writes).toEqual(["tela refeita"]));
    expect(term.resets).toBe(2);

    act(() => socket.push("run.ephemeral", terminal("!")));
    await waitFor(() => expect(term.writes).toEqual(["tela refeita", "!"]));
    expect(term.resets).toBe(2);
  });

  it("manda o que se digita por terminal.input, sem gravar o texto em lugar nenhum", async () => {
    const log = vi.spyOn(console, "log");
    const { socket, term } = await openPanel();

    act(() => term.type("ls\r"));
    expect(socket.sent.at(-1)).toEqual({
      event: "terminal.input",
      data: { runId, agent: "Pesquisador", data: "ls\r" },
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("mostra em pt-BR o erro que o servidor devolveu", async () => {
    const { socket, term } = await openPanel();

    act(() => term.type("a"));
    act(() => socket.push("error", { code: "rate_limited", message: "Too many" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("rápido demais");

    act(() => socket.push("error", { code: "terminal_not_ready", message: "x" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ainda não subiu");

    // The next keystroke clears the old message.
    act(() => term.type("b"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("deixa o terminal só para leitura quando a execução termina", async () => {
    const { socket, term } = await openPanel();
    expect(term.options["disableStdin"]).toBe(false);
    act(() =>
      socket.push("run.event", frame(3, "RunFinished", "Pesquisador", { reason: "finished" })),
    );
    await waitFor(() => expect(term.options["disableStdin"]).toBe(true));
    expect(screen.getByText(/terminou: o terminal fica só para leitura/)).toBeInTheDocument();
  });

  describe("tamanho do terminal", () => {
    const resizes = (socket: FakeSocket) =>
      socket.sent.filter((message) => message.event === "terminal.resize");

    it("manda o tamanho da caixa por terminal.resize, uma vez só, depois que ela para de mudar", async () => {
      const { socket } = await openPanel();

      await waitFor(() => expect(resizes(socket)).toHaveLength(1));
      expect(resizes(socket)[0]).toEqual({
        event: "terminal.resize",
        data: { runId, agent: "Pesquisador", cols: 90, rows: 30 },
      });

      // The browser reports the same box again: nothing new to say.
      act(() => fake.observers.forEach((notify) => notify([])));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(resizes(socket)).toHaveLength(1);
    });

    it("junta uma rajada de mudanças numa mensagem só, com o tamanho final", async () => {
      const { socket } = await openPanel();
      await waitFor(() => expect(resizes(socket)).toHaveLength(1));

      act(() => {
        for (const cols of [100, 110, 120, 130]) {
          fake.box.dimensions = { cols, rows: 35 };
          fake.observers.forEach((notify) => notify([]));
        }
      });

      await waitFor(() => expect(resizes(socket)).toHaveLength(2));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(resizes(socket)).toHaveLength(2);
      expect(resizes(socket)[1]?.data).toEqual({
        runId,
        agent: "Pesquisador",
        cols: 130,
        rows: 35,
      });
    });

    it("não manda nada quando a caixa ainda não tem medida", async () => {
      fake.box.dimensions = undefined;
      const { socket } = await openPanel();
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(resizes(socket)).toHaveLength(0);
    });

    it("manda o tamanho de novo depois de reconectar, porque o servidor esquece quem saiu", async () => {
      const { socket } = await openPanel();
      await waitFor(() => expect(resizes(socket)).toHaveLength(1));

      act(() => socket.drop());
      await waitFor(() => expect(FakeSocket.instances).toHaveLength(2), { timeout: 5000 });
      const second = FakeSocket.last;
      act(() => {
        second.open();
        second.push("subscribed", { runId });
      });

      expect(resizes(second)).toEqual([
        {
          event: "terminal.resize",
          data: { runId, agent: "Pesquisador", cols: 90, rows: 30 },
        },
      ]);
    });

    it("segue o tamanho que o servidor deu ao terminal, sem apagar a tela", async () => {
      const { socket, term } = await openPanel();
      act(() => socket.push("run.ephemeral", terminal("tela")));
      await waitFor(() => expect(term.writes).toEqual(["tela"]));
      expect(term.cols).toBe(120);

      act(() =>
        socket.push("run.ephemeral", {
          runId,
          type: "TerminalResized",
          agent: "Pesquisador",
          cols: 80,
          rows: 24,
        }),
      );

      await waitFor(() => expect([term.cols, term.rows]).toEqual([80, 24]));
      expect(term.resets).toBe(1);
      expect(term.writes).toEqual(["tela"]);
    });

    it("desenha o resumo do servidor no tamanho em que ele foi impresso", async () => {
      const { socket, term } = await openPanel();
      const order: string[] = [];
      const resize = term.resize.bind(term);
      term.resize = (cols, rows) => {
        order.push(`resize ${cols}x${rows}`);
        resize(cols, rows);
      };
      const write = term.write.bind(term);
      term.write = (data) => {
        order.push(`write ${data}`);
        write(data);
      };

      act(() =>
        socket.push("run.ephemeral", {
          ...terminal("tela nova", true),
          cols: 100,
          rows: 30,
        }),
      );

      await waitFor(() => expect(order).toEqual(["resize 100x30", "write tela nova"]));
    });

    it("não manda o tamanho quando a execução já terminou", async () => {
      const { socket } = await openPanel();
      await waitFor(() => expect(resizes(socket)).toHaveLength(1));
      act(() =>
        socket.push("run.event", frame(3, "RunFinished", "Pesquisador", { reason: "finished" })),
      );

      fake.box.dimensions = { cols: 70, rows: 20 };
      act(() => fake.observers.forEach((notify) => notify([])));
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(resizes(socket)).toHaveLength(1);
    });

    it("mostra em pt-BR quando o servidor recusa o tamanho", async () => {
      const { socket } = await openPanel();
      act(() => socket.push("error", { code: "invalid_size", message: "x" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("não aceitou esse tamanho");
    });
  });

  it("um agente em stream-json mostra só a conversa", async () => {
    renderApp(`/runs/${runId}`, routes);
    const socket = await openSocket();
    act(() => socket.push("run.event", state(1, "Revisor", "busy")));
    fireEvent.click(await screen.findByTestId("block-b"));
    expect(await screen.findByText(/modo stream-json/)).toBeInTheDocument();
    expect(fake.FakeTerminal.instances).toHaveLength(0);
  });
});
