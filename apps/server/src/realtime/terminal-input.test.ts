import type { AgentNode, GraphDefinition } from "@neurons/graph-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunSubscriptions } from "./run-subscriptions.js";
import { TerminalUnavailableError } from "./terminal-errors.js";
import { TerminalInput } from "./terminal-input.js";
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

describe("TerminalInput", () => {
  let sessions: TerminalSessions;
  let terminal: FakeTerminal;
  let running: boolean;
  let input: TerminalInput;
  const client = {};

  const limits = { maxChars: 20, maxPerSecond: 5 };
  const type = (data: string, agentName = "Terminal", runId = RUN) =>
    input.write(client, { runId, agent: agentName, data });
  const refusal = (action: () => void): { code: string; message: string } => {
    try {
      action();
    } catch (error) {
      return error as { code: string; message: string };
    }
    throw new Error("a entrada deveria ter sido recusada");
  };

  beforeEach(() => {
    vi.useFakeTimers();
    sessions = new TerminalSessions(new RunSubscriptions({ readFrom: () => Promise.resolve([]) }));
    running = true;
    sessions.useRunLookup({ find: (runId) => (running && runId === RUN ? { graph } : undefined) });
    terminal = new FakeTerminal();
    sessions.attach(RUN, "Terminal", terminal.asRuntime());
    input = new TerminalInput(sessions, limits);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("types into the terminal of an agent of a running run, exactly as it came", () => {
    type("ls -la\r");
    type("\x1b[A");

    expect(terminal.typed).toEqual(["ls -la\r", "\x1b[A"]);
  });

  it("refuses a run that is not running", () => {
    running = false;

    expect(refusal(() => type("x")).code).toBe("run_not_running");
    expect(refusal(() => type("x", "Terminal", "0192f1c0-0000-7000-8000-0000000000ff")).code).toBe(
      "run_not_running",
    );
    expect(terminal.typed).toEqual([]);
  });

  it("refuses an agent that is not in the run", () => {
    expect(refusal(() => type("x", "Fantasma")).code).toBe("agent_not_in_run");
  });

  it("refuses an agent that has no terminal to type into (API or stream-json)", () => {
    expect(refusal(() => type("x", "Api")).code).toBe("not_a_terminal");
    expect(refusal(() => type("x", "Headless")).code).toBe("not_a_terminal");
  });

  it("says the terminal is not ready when the agent has not started yet", () => {
    sessions.attach(RUN, "Terminal", terminal.asRuntime())(); // the session ended
    expect(refusal(() => type("x")).code).toBe("terminal_not_ready");
  });

  it("says the terminal is unreachable when the runtime cannot take the input", () => {
    terminal.failWith = new Error("pty morto com detalhes internos");

    const error = refusal(() => type("x"));

    expect(error.code).toBe("terminal_unavailable");
    expect(error.message).not.toContain("pty morto");
    expect(refusal(() => type("x"))).toBeInstanceOf(TerminalUnavailableError);
  });

  it("refuses a message with more characters than the limit, and accepts exactly the limit", () => {
    expect(refusal(() => type("x".repeat(21))).code).toBe("input_too_large");
    type("x".repeat(20));

    expect(terminal.typed).toEqual(["x".repeat(20)]);
  });

  it("allows a burst of the rate and then refuses, until time passes", () => {
    for (let i = 0; i < 5; i++) type("a");

    expect(refusal(() => type("a")).code).toBe("rate_limited");
    vi.advanceTimersByTime(200); // one token per 200 ms at 5/s
    type("b");
    expect(refusal(() => type("c")).code).toBe("rate_limited");
    expect(terminal.typed).toEqual(["a", "a", "a", "a", "a", "b"]);
  });

  it("counts the rate per connection", () => {
    for (let i = 0; i < 5; i++) type("a");

    expect(() => input.write({}, { runId: RUN, agent: "Terminal", data: "outro" })).not.toThrow();
  });

  it("never repeats what was typed in a refusal", () => {
    const secret = "senha-super-secreta-123";
    running = false;
    const messages = [
      refusal(() => type(secret)).message,
      refusal(() => type(secret, "Fantasma")).message,
      refusal(() => type(secret, "Api")).message,
      refusal(() => type(secret.repeat(5))).message,
    ];

    for (const message of messages) expect(message).not.toContain("senha");
  });
});
