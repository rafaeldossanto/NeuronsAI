import { Inject, Injectable } from "@nestjs/common";
import {
  DEFAULT_TERMINAL_SIZE,
  type StreamingAgentRuntime,
  type TerminalAgentRuntime,
  type TerminalSize,
} from "@neurons/agent-runtimes";
import type { GraphDefinition } from "@neurons/graph-schema";
import type { Unsubscribe } from "../shared/signal.js";
import type { EventSink } from "./run-event.js";
import { RunSubscriptions } from "./run-subscriptions.js";
import { TerminalNotFoundError } from "./terminal-errors.js";
import { TerminalSizeNegotiation } from "./terminal-size.js";

export { TerminalNotFoundError } from "./terminal-errors.js";

/** The runs this process is driving, so a terminal can be told apart from "the run is not running". */
export interface ActiveRunLookup {
  find(runId: string): { graph: GraphDefinition } | undefined;
}

/**
 * The live terminals of the active runs. Their raw output goes to the run's subscribers as an
 * ephemeral event (never to the run log); whoever subscribes later gets the runtime's buffer of
 * the latest output first. The user types into a terminal through {@link writeInput}. The size of a
 * terminal is the smallest the connected viewers asked for ({@link reportSize}).
 */
@Injectable()
export class TerminalSessions {
  private readonly sessions = new Map<string, Map<string, TerminalAgentRuntime>>();
  private readonly sizes = new TerminalSizeNegotiation();
  private runLookup: ActiveRunLookup | undefined;

  constructor(@Inject(RunSubscriptions) private readonly subscriptions: RunSubscriptions) {}

  /** Who knows the active runs and their graphs; set by whoever drives the runs (the Supervisor). */
  useRunLookup(lookup: ActiveRunLookup): void {
    this.runLookup = lookup;
  }

  /** The graph of the run while it is running in this process. */
  activeGraph(runId: string): GraphDefinition | undefined {
    return this.runLookup?.find(runId)?.graph;
  }

  /** Starts publishing the runtime's output; the returned function ends it. */
  attach(runId: string, agent: string, runtime: TerminalAgentRuntime): Unsubscribe {
    const byAgent = this.sessions.get(runId) ?? new Map<string, TerminalAgentRuntime>();
    this.sessions.set(runId, byAgent);
    byAgent.set(agent, runtime);
    // Viewers that already said how big their screen is (the terminal opens on the agent's first message).
    const asked = this.sizes.current(runId, agent);
    if (asked) runtime.resize(asked.cols, asked.rows);

    const stopListening = runtime.onOutput((data) =>
      this.subscriptions.publishEphemeral({
        runId,
        type: "TerminalOutput",
        agent,
        data,
        replay: false,
        at: new Date(),
      }),
    );
    const stopResizing = runtime.onResize(({ cols, rows }) =>
      this.subscriptions.publishEphemeral({
        runId,
        type: "TerminalResized",
        agent,
        cols,
        rows,
        at: new Date(),
      }),
    );
    return () => {
      stopListening();
      stopResizing();
      this.sizes.drop(runId, agent);
      byAgent.delete(agent);
      if (byAgent.size === 0) this.sessions.delete(runId);
    };
  }

  /**
   * Starts publishing what a streaming runtime (API, stream-json) writes while the model generates
   * it, as the ephemeral `AgentOutputDelta`; the returned function ends it. Nothing is kept for
   * whoever subscribes later: they get the final message through the run log.
   */
  attachOutputStream(runId: string, agent: string, runtime: StreamingAgentRuntime): Unsubscribe {
    return runtime.onOutputDelta(({ turnId, channel, delta }) =>
      this.subscriptions.publishEphemeral({
        runId,
        type: "AgentOutputDelta",
        agent,
        turnId,
        channel,
        delta,
        at: new Date(),
      }),
    );
  }

  /**
   * Sends the sink what each terminal of the run printed lately (about the last 200 KB), with the
   * size it was printed at: the snapshot starts at the last resize, so it fits that size exactly.
   * A terminal that was resized but printed nothing since still tells its size.
   */
  replayTo(sink: EventSink, runId: string): void {
    for (const [agent, runtime] of this.sessions.get(runId) ?? []) {
      const data = runtime.outputSnapshot();
      const { cols, rows } = runtime.size;
      if (data) {
        sink.sendEphemeral({
          runId,
          type: "TerminalOutput",
          agent,
          data,
          replay: true,
          cols,
          rows,
          at: new Date(),
        });
      } else if (!isDefaultSize(runtime.size)) {
        sink.sendEphemeral({ runId, type: "TerminalResized", agent, cols, rows, at: new Date() });
      }
    }
  }

  /** Types into the agent's terminal as the user would. @throws TerminalNotFoundError */
  writeInput(runId: string, agent: string, data: string): void {
    const runtime = this.sessions.get(runId)?.get(agent);
    if (!runtime) throw new TerminalNotFoundError(agent);
    runtime.writeInput(data);
  }

  /**
   * A viewer says how much of the terminal it can show. The terminal takes the smallest size among
   * its viewers, so a new, bigger viewer never reshapes what the others see. The runtime tells
   * everyone the size it applied (`TerminalResized`). A terminal that is not open yet takes the
   * size when it opens.
   */
  reportSize(client: object, runId: string, agent: string, cols: number, rows: number): void {
    const wanted = this.sizes.report(client, runId, agent, { cols, rows });
    this.sessions.get(runId)?.get(agent)?.resize(wanted.cols, wanted.rows);
  }

  /**
   * A viewer left (its connection closed, or `runId` when it stopped following that run): the
   * terminals it was holding smaller can grow back to what the remaining viewers can show.
   */
  forgetViewer(client: object, runId?: string): void {
    for (const { runId: run, agent, size } of this.sizes.forget(client, runId)) {
      if (size) this.sessions.get(run)?.get(agent)?.resize(size.cols, size.rows);
    }
  }
}

const isDefaultSize = (size: TerminalSize) =>
  size.cols === DEFAULT_TERMINAL_SIZE.cols && size.rows === DEFAULT_TERMINAL_SIZE.rows;
