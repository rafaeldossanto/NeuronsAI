import { Inject, Injectable } from "@nestjs/common";
import type { TerminalAgentRuntime } from "@neurons/agent-runtimes";
import type { GraphDefinition } from "@neurons/graph-schema";
import type { Unsubscribe } from "../shared/signal.js";
import type { EventSink } from "./run-event.js";
import { RunSubscriptions } from "./run-subscriptions.js";
import { TerminalNotFoundError } from "./terminal-errors.js";

export { TerminalNotFoundError } from "./terminal-errors.js";

/** The runs this process is driving, so a terminal can be told apart from "the run is not running". */
export interface ActiveRunLookup {
  find(runId: string): { graph: GraphDefinition } | undefined;
}

/**
 * The live terminals of the active runs. Their raw output goes to the run's subscribers as an
 * ephemeral event (never to the run log); whoever subscribes later gets the runtime's buffer of
 * the latest output first. The user types into a terminal through {@link writeInput}.
 */
@Injectable()
export class TerminalSessions {
  private readonly sessions = new Map<string, Map<string, TerminalAgentRuntime>>();
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
    return () => {
      stopListening();
      byAgent.delete(agent);
      if (byAgent.size === 0) this.sessions.delete(runId);
    };
  }

  /** Sends the sink what each terminal of the run printed lately (about the last 200 KB). */
  replayTo(sink: EventSink, runId: string): void {
    for (const [agent, runtime] of this.sessions.get(runId) ?? []) {
      const data = runtime.outputSnapshot();
      if (data) {
        sink.sendEphemeral({
          runId,
          type: "TerminalOutput",
          agent,
          data,
          replay: true,
          at: new Date(),
        });
      }
    }
  }

  /** Types into the agent's terminal as the user would. @throws TerminalNotFoundError */
  writeInput(runId: string, agent: string, data: string): void {
    const runtime = this.sessions.get(runId)?.get(agent);
    if (!runtime) throw new TerminalNotFoundError(agent);
    runtime.writeInput(data);
  }
}
