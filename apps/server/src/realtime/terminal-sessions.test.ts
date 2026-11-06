import { beforeEach, describe, expect, it } from "vitest";
import type { EphemeralRunEvent, EventSink, RunEvent } from "./run-event.js";
import { RunSubscriptions } from "./run-subscriptions.js";
import { TerminalNotFoundError, TerminalSessions } from "./terminal-sessions.js";
import { FakeTerminal } from "./testing/fake-terminal.js";

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

  describe("size", () => {
    const sizes = (events: EphemeralRunEvent[]) =>
      events.flatMap((event) =>
        event.type === "TerminalResized" ? [`${event.cols}x${event.rows}`] : [],
      );

    it("tells everyone who follows the run when a terminal changes size", () => {
      const terminal = new FakeTerminal();
      sessions.attach(RUN, "Pesquisador", terminal.asRuntime());

      sessions.reportSize({}, RUN, "Pesquisador", 100, 30);

      expect(sink.ephemeral).toMatchObject([
        { runId: RUN, type: "TerminalResized", agent: "Pesquisador", cols: 100, rows: 30 },
      ]);
      expect(sink.stored).toEqual([]); // never in the run log
    });

    it("takes the smallest size among the viewers, and grows back when the small one leaves", () => {
      const terminal = new FakeTerminal();
      sessions.attach(RUN, "Pesquisador", terminal.asRuntime());
      const big = {};
      const small = {};

      sessions.reportSize(big, RUN, "Pesquisador", 200, 50);
      sessions.reportSize(small, RUN, "Pesquisador", 80, 24);
      sessions.reportSize(big, RUN, "Pesquisador", 220, 60); // the big one moving again changes nothing
      sessions.forgetViewer(small);

      expect(sizes(sink.ephemeral)).toEqual(["200x50", "80x24", "220x60"]);
      expect(terminal.size).toEqual({ cols: 220, rows: 60 });
    });

    it("keeps the size when the last viewer leaves", () => {
      const terminal = new FakeTerminal();
      sessions.attach(RUN, "Pesquisador", terminal.asRuntime());
      const viewer = {};
      sessions.reportSize(viewer, RUN, "Pesquisador", 90, 30);

      sessions.forgetViewer(viewer);

      expect(terminal.size).toEqual({ cols: 90, rows: 30 });
    });

    it("lets a viewer that stops following the run stop counting for it", () => {
      const terminal = new FakeTerminal();
      sessions.attach(RUN, "Pesquisador", terminal.asRuntime());
      const staying = {};
      const leaving = {};
      sessions.reportSize(staying, RUN, "Pesquisador", 150, 40);
      sessions.reportSize(leaving, RUN, "Pesquisador", 60, 20);

      sessions.forgetViewer(leaving, RUN);

      expect(terminal.size).toEqual({ cols: 150, rows: 40 });
    });

    it("sends a late viewer the replay with the size it was printed at", () => {
      const terminal = new FakeTerminal();
      sessions.attach(RUN, "Pesquisador", terminal.asRuntime());
      terminal.print("tela antiga ");
      sessions.reportSize({}, RUN, "Pesquisador", 100, 30);
      terminal.print("tela nova");

      const late = new RecordingSink();
      sessions.replayTo(late, RUN);

      // What was printed for the old size is not replayed: it would be garbled at 100x30.
      expect(late.ephemeral).toMatchObject([
        { type: "TerminalOutput", data: "tela nova", replay: true, cols: 100, rows: 30 },
      ]);
    });

    it("tells a late viewer the size of a terminal that was resized and has not printed since", () => {
      const terminal = new FakeTerminal();
      sessions.attach(RUN, "Pesquisador", terminal.asRuntime());
      sessions.reportSize({}, RUN, "Pesquisador", 100, 30);

      const late = new RecordingSink();
      sessions.replayTo(late, RUN);

      expect(late.ephemeral).toMatchObject([
        { type: "TerminalResized", agent: "Pesquisador", cols: 100, rows: 30 },
      ]);
    });

    it("stops telling about a terminal that was detached", () => {
      const terminal = new FakeTerminal();
      const detach = sessions.attach(RUN, "Pesquisador", terminal.asRuntime());
      detach();

      terminal.resize(90, 30);

      expect(sink.ephemeral).toEqual([]);
    });
  });

  it("refuses input for an agent without a terminal", () => {
    expect(() => sessions.writeInput(RUN, "Fantasma", "x")).toThrow(/não tem um terminal/);
  });
});
