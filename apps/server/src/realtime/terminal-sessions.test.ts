import { Signal, type TerminalAgentRuntime } from "@neurons/agent-runtimes";
import { beforeEach, describe, expect, it } from "vitest";
import type { EphemeralRunEvent, EventSink, RunEvent } from "./run-event.js";
import { RunSubscriptions } from "./run-subscriptions.js";
import { TerminalNotFoundError, TerminalSessions } from "./terminal-sessions.js";

const RUN = "0192f1c0-0000-7000-8000-000000000001";

class RecordingSink implements EventSink {
  readonly ephemeral: EphemeralRunEvent[] = [];
  readonly stored: RunEvent[] = [];
  send(event: RunEvent): void {
    this.stored.push(event);
  }
  sendEphemeral(event: EphemeralRunEvent): void {
    this.ephemeral.push(event);
  }
}

/** Just the terminal side of a runtime. */
class FakeTerminal {
  readonly typed: string[] = [];
  private readonly output = new Signal<string>();
  private buffer = "";

  print(chunk: string): void {
    this.buffer += chunk;
    this.output.emit(chunk);
  }
  onOutput = (listener: (chunk: string) => void) => this.output.subscribe(listener);
  outputSnapshot = () => this.buffer;
  writeInput = (data: string) => void this.typed.push(data);
  asRuntime = () => this as unknown as TerminalAgentRuntime;
}

describe("TerminalSessions", () => {
  let subscriptions: RunSubscriptions;
  let sessions: TerminalSessions;
  let sink: RecordingSink;

  beforeEach(async () => {
    subscriptions = new RunSubscriptions({ readFrom: () => Promise.resolve([]) });
    sessions = new TerminalSessions(subscriptions);
    sink = new RecordingSink();
    await subscriptions.subscribe(sink, RUN);
  });

  it("publishes the raw output live, as an ephemeral event that is never stored", () => {
    const terminal = new FakeTerminal();
    sessions.attach(RUN, "Pesquisador", terminal.asRuntime());

    terminal.print("\x1b[2Jolá");

    expect(sink.stored).toEqual([]);
    expect(sink.ephemeral).toMatchObject([
      {
        runId: RUN,
        type: "TerminalOutput",
        agent: "Pesquisador",
        data: "\x1b[2Jolá",
        replay: false,
      },
    ]);
  });

  it("does not publish to subscribers of other runs", async () => {
    const elsewhere = new RecordingSink();
    await subscriptions.subscribe(elsewhere, "0192f1c0-0000-7000-8000-000000000002");
    const terminal = new FakeTerminal();
    sessions.attach(RUN, "Pesquisador", terminal.asRuntime());

    terminal.print("x");

    expect(elsewhere.ephemeral).toEqual([]);
  });

  it("gives a client that subscribes late the latest output as a replay", () => {
    const terminal = new FakeTerminal();
    sessions.attach(RUN, "Pesquisador", terminal.asRuntime());
    terminal.print("antes ");
    terminal.print("de entrar");

    const late = new RecordingSink();
    sessions.replayTo(late, RUN);

    expect(late.ephemeral).toMatchObject([
      { agent: "Pesquisador", data: "antes de entrar", replay: true },
    ]);
  });

  it("sends nothing to replay when the terminal has not printed yet", () => {
    sessions.attach(RUN, "Pesquisador", new FakeTerminal().asRuntime());
    const late = new RecordingSink();
    sessions.replayTo(late, RUN);
    expect(late.ephemeral).toEqual([]);
  });

  it("types what the user types into the right terminal", () => {
    const terminal = new FakeTerminal();
    sessions.attach(RUN, "Pesquisador", terminal.asRuntime());

    sessions.writeInput(RUN, "Pesquisador", "ls\r");

    expect(terminal.typed).toEqual(["ls\r"]);
  });

  it("stops publishing and forgets the terminal once detached", () => {
    const terminal = new FakeTerminal();
    const detach = sessions.attach(RUN, "Pesquisador", terminal.asRuntime());

    detach();
    terminal.print("depois");

    expect(sink.ephemeral).toEqual([]);
    expect(() => sessions.writeInput(RUN, "Pesquisador", "x")).toThrow(TerminalNotFoundError);
  });

  it("refuses input for an agent without a terminal", () => {
    expect(() => sessions.writeInput(RUN, "Fantasma", "x")).toThrow(/não tem um terminal/);
  });
});
