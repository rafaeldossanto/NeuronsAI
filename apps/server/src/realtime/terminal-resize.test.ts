import type { AgentNode, GraphDefinition } from "@neurons/graph-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunSubscriptions } from "./run-subscriptions.js";
import { TerminalResize } from "./terminal-resize.js";
import { TerminalSessions } from "./terminal-sessions.js";
import { FakeTerminal } from "./testing/fake-terminal.js";

const RUN = "0192f1c0-0000-7000-8000-000000000001";
const position = { x: 0, y: 0 };

const agent = (name: string, runtime: AgentNode["runtime"]): AgentNode => ({
  id: `agente-${name.toLowerCase()}`,
  type: "agent",
  position,
  name,
  role: "papel",
  instructions: "instruções",
  effort: "medium",
  runtime,
});

const graph: GraphDefinition = {
  schemaVersion: 1,
  id: "5b440250-ceba-42f4-8ce6-717a290384c4",
  name: "Grafo de teste",
  nodes: [
    agent("Terminal", { kind: "terminal", cli: "claude", mode: "pty", cwd: "/tmp", args: [] }),
    agent("Headless", {
      kind: "terminal",
      cli: "claude",
      mode: "stream-json",
      cwd: "/tmp",
      args: [],
    }),
    agent("Api", { kind: "api", provider: "anthropic", model: "claude-sonnet-5-5" }),
  ],
  links: [],
  annotations: [],
};

describe("TerminalResize", () => {
  let sessions: TerminalSessions;
  let terminal: FakeTerminal;
  let running: boolean;
  let resize: TerminalResize;
  const client = {};

  const ask = (cols: number, rows: number, agentName = "Terminal", runId = RUN, who = client) =>
    resize.request(who, { runId, agent: agentName, cols, rows });
  const refusal = (action: () => void): { code: string; message: string } => {
    try {
      action();
    } catch (error) {
      return error as { code: string; message: string };
    }
    throw new Error("o pedido deveria ter sido recusado");
  };

  beforeEach(() => {
    vi.useFakeTimers();
    sessions = new TerminalSessions(new RunSubscriptions({ readFrom: () => Promise.resolve([]) }));
    running = true;
    sessions.useRunLookup({ find: (runId) => (running && runId === RUN ? { graph } : undefined) });
    terminal = new FakeTerminal();
    sessions.attach(RUN, "Terminal", terminal.asRuntime());
    resize = new TerminalResize(sessions);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resizes the terminal of an agent of a running run", () => {
    ask(100, 30);
    expect(terminal.resized).toEqual([{ cols: 100, rows: 30 }]);
  });

  it("refuses a run that is not running", () => {
    running = false;
    expect(refusal(() => ask(100, 30)).code).toBe("run_not_running");
    expect(
      refusal(() => ask(100, 30, "Terminal", "0192f1c0-0000-7000-8000-0000000000ff")).code,
    ).toBe("run_not_running");
    expect(terminal.resized).toEqual([]);
  });

  it("refuses an agent that is not in the run, or that has no terminal", () => {
    expect(refusal(() => ask(100, 30, "Fantasma")).code).toBe("agent_not_in_run");
    expect(refusal(() => ask(100, 30, "Api")).code).toBe("not_a_terminal");
    expect(refusal(() => ask(100, 30, "Headless")).code).toBe("not_a_terminal");
  });

  it.each([
    [19, 40],
    [401, 40],
    [120, 4],
    [120, 201],
    [0, 0],
    [-5, 40],
  ])("refuses %i x %i with the accepted range, in pt-BR", (cols, rows) => {
    const error = refusal(() => ask(cols, rows));
    expect(error.code).toBe("invalid_size");
    expect(error.message).toBe("O terminal aceita de 20 a 400 colunas e de 5 a 200 linhas.");
    expect(terminal.resized).toEqual([]);
  });

  it("accepts exactly the edges of the range", () => {
    ask(20, 5);
    ask(400, 200);
    expect(terminal.resized).toEqual([
      { cols: 20, rows: 5 },
      { cols: 400, rows: 200 },
    ]);
  });

  it("allows a burst of the rate and then refuses, until time passes", () => {
    for (let i = 0; i < 5; i++) ask(80 + i, 24);

    expect(refusal(() => ask(90, 24)).code).toBe("resize_rate_limited");
    vi.advanceTimersByTime(200); // one token per 200 ms at 5/s
    ask(91, 24);

    expect(terminal.size).toEqual({ cols: 91, rows: 24 });
  });

  it("counts the rate per connection", () => {
    for (let i = 0; i < 5; i++) ask(80 + i, 24);
    expect(refusal(() => ask(90, 24)).code).toBe("resize_rate_limited");

    ask(100, 30, "Terminal", RUN, {}); // somebody else is not held back

    expect(terminal.resized.at(-1)).toEqual({ cols: 84, rows: 24 }); // the smallest of both
  });

  it("opens the terminal at the size the viewer asked for before it existed", () => {
    // A fresh server state: the agent's terminal has not opened yet (it opens on the first message).
    sessions = new TerminalSessions(new RunSubscriptions({ readFrom: () => Promise.resolve([]) }));
    sessions.useRunLookup({ find: () => ({ graph }) });
    resize = new TerminalResize(sessions);

    ask(100, 30); // accepted: nothing to resize yet, the size is remembered

    const opened = new FakeTerminal();
    sessions.attach(RUN, "Terminal", opened.asRuntime());
    expect(opened.resized).toEqual([{ cols: 100, rows: 30 }]);
  });
});
