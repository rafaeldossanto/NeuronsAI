import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  isTerminalRuntime,
  type AgentRuntime,
  type AgentRuntimeFactory,
  type AgentRuntimeState,
} from "@neurons/agent-runtimes";
import { peersOf, type AgentNode } from "@neurons/graph-schema";
import { AGENT_RUNTIME_FACTORY } from "../agents/agent-runtime-factory.js";
import { TerminalSessions } from "../realtime/terminal-sessions.js";
import { RunEventRecorder } from "../run-log/run-event-recorder.js";
import { RUN_REPOSITORY, type RunRepository } from "../run-log/run-repository.js";
import { Signal, type Unsubscribe } from "../shared/signal.js";
import { findAgent } from "./agent-lookup.js";
import { buildBriefing } from "./briefing.js";
import { HubAgentCommunication } from "./hub-agent-communication.js";
import { HubEvents } from "./hub-events.js";
import { Hub } from "./hub.js";
import type { MessageRecord } from "./message.js";
import { RunRegistry } from "./run-registry.js";

type SlotState = AgentRuntimeState | "failed";

/** States in which an agent is still working, so the run cannot be quiet. */
const ACTIVE_STATES: ReadonlySet<SlotState> = new Set(["starting", "busy", "waiting_reply"]);
/** States in which an agent will never take another message. */
const DEAD_STATES: ReadonlySet<SlotState> = new Set(["stopped", "failed"]);

interface AgentSlot {
  readonly runId: string;
  readonly agent: AgentNode;
  runtime: AgentRuntime | undefined;
  /** Resolves when the runtime finished booting (or failed to). Never rejects. */
  booted: Promise<void>;
  /** The runtime could not be created or started. */
  failed: boolean;
  /** An inbox pump is running; also true while a message is being handed over. */
  pumping: boolean;
  /** Something changed while pumping: look at the inbox once more. */
  repump: boolean;
  unsubscribe: Unsubscribe;
  /** Stops publishing the terminal output of a terminal runtime. */
  detachTerminal: Unsubscribe;
}

/**
 * Keeps the live agent sessions of the active runs: starts an agent on the first message it
 * receives and hands over its inbox in order (FIFO) every time it is idle.
 */
@Injectable()
export class Supervisor {
  /** Something happened that may have left the run quiet: nudge whoever checks for the end. */
  readonly settled = new Signal<string>();

  private readonly logger = new Logger(Supervisor.name);
  private readonly slots = new Map<string, Map<string, AgentSlot>>();
  private readonly stopping = new Map<string, Promise<void>>();

  constructor(
    @Inject(Hub) private readonly hub: Hub,
    @Inject(AGENT_RUNTIME_FACTORY) private readonly factory: AgentRuntimeFactory,
    @Inject(RunRegistry) private readonly registry: RunRegistry,
    @Inject(RUN_REPOSITORY) private readonly runs: RunRepository,
    @Inject(RunEventRecorder) private readonly recorder: RunEventRecorder,
    @Inject(TerminalSessions) private readonly terminals: TerminalSessions,
  ) {
    this.hub.messageRecorded.subscribe((message) => this.onMessage(message));
    this.hub.askClosed.subscribe((runId) => this.settled.emit(runId));
  }

  /**
   * Boot-time recovery: for every running run, hands over again what was never acknowledged
   * (the process died in between), starting the agents that need it.
   */
  async recover(): Promise<void> {
    for (const { run, graph } of await this.runs.listRunning()) {
      this.registry.register(run.id, graph);
      const recipients = new Set((await this.hub.unacked(run.id)).map((message) => message.to));
      for (const name of recipients) {
        const slot = this.ensureSlot(run.id, name);
        if (slot) this.schedulePump(slot);
      }
      // Nothing left to deliver means the run is already quiet; let it be closed.
      this.settled.emit(run.id);
    }
  }

  /**
   * True when nobody is working, nothing is being stored or waiting for an answer, and no
   * message is left for an agent that can still receive it.
   */
  async isQuiescent(runId: string): Promise<boolean> {
    if (!this.isIdleNow(runId)) return false;
    const unacked = await this.hub.unacked(runId);
    if (unacked.some((message) => this.canStillReceive(runId, message.to))) return false;
    // Anything may have started while the inbox was being read.
    return this.isIdleNow(runId);
  }

  /**
   * Stops every runtime of the run. Calling it again while a stop is under way waits for that one,
   * so "resolved" always means the processes are gone and their temporary files deleted.
   */
  stopRun(runId: string): Promise<void> {
    const underWay = this.stopping.get(runId);
    if (underWay) return underWay;

    const slots = [...(this.slots.get(runId)?.values() ?? [])];
    this.slots.delete(runId);
    const stopped = Promise.all(slots.map((slot) => this.stopSlot(slot))).then(() => undefined);
    this.stopping.set(runId, stopped);
    return stopped.finally(() => this.stopping.delete(runId));
  }

  /** Stops every runtime of every run (server shutdown); the runs stay `running` for `recover`. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.slots.keys()].map((runId) => this.stopRun(runId)));
  }

  // ---- reacting to messages and runtime states ----

  private onMessage(message: MessageRecord): void {
    const slot = this.ensureSlot(message.runId, message.to);
    if (slot) this.schedulePump(slot);
  }

  private onStateChange(slot: AgentSlot, state: AgentRuntimeState): void {
    if (state === "idle") this.schedulePump(slot);
    if (state === "failed") void this.reportFailure(slot, slot.runtime?.failureReason);
    if (state === "idle" || DEAD_STATES.has(state)) this.settled.emit(slot.runId);
  }

  // ---- slots ----

  private ensureSlot(runId: string, agentName: string): AgentSlot | undefined {
    const bySlot = this.slots.get(runId) ?? new Map<string, AgentSlot>();
    this.slots.set(runId, bySlot);
    const existing = bySlot.get(agentName);
    if (existing) return existing;

    const graph = this.registry.find(runId)?.graph;
    const agent = graph && findAgent(graph, agentName);
    if (!graph || !agent) return undefined;

    const slot: AgentSlot = {
      runId,
      agent,
      runtime: undefined,
      booted: Promise.resolve(),
      failed: false,
      pumping: false,
      repump: false,
      unsubscribe: () => undefined,
      detachTerminal: () => undefined,
    };
    bySlot.set(agentName, slot);
    slot.booted = this.boot(slot, buildBriefing(agent, peersOf(graph, agentName)));
    return slot;
  }

  private async boot(slot: AgentSlot, briefing: string): Promise<void> {
    try {
      const communication = new HubAgentCommunication(this.hub, slot.runId, slot.agent.name);
      const runtime = this.factory.create(slot.agent, communication);
      slot.runtime = runtime;
      slot.unsubscribe = runtime.onStateChange((state) => this.onStateChange(slot, state));
      // Before `start`, so what the CLI prints while booting (dialogs, login) is watchable too.
      if (isTerminalRuntime(runtime)) {
        slot.detachTerminal = this.terminals.attach(slot.runId, slot.agent.name, runtime);
      }
      await this.recorder.record(slot.runId, [HubEvents.agentStarted(slot.agent.name, briefing)]);
      await runtime.start(briefing);
    } catch (error) {
      await this.reportFailure(slot, errorMessage(error));
    }
  }

  private stateOf(slot: AgentSlot): SlotState {
    if (slot.failed) return "failed";
    return slot.runtime?.state ?? "starting";
  }

  private async reportFailure(slot: AgentSlot, reason: string | undefined): Promise<void> {
    if (slot.failed) return;
    slot.failed = true;
    try {
      await this.recorder.record(slot.runId, [
        HubEvents.agentFailed(slot.agent.name, reason ?? "O agente falhou."),
      ]);
    } catch (error) {
      this.logger.error(
        `Não foi possível registrar a falha de "${slot.agent.name}": ${errorMessage(error)}`,
      );
    }
    this.settled.emit(slot.runId);
  }

  private async stopSlot(slot: AgentSlot): Promise<void> {
    slot.unsubscribe();
    await slot.booted;
    try {
      await slot.runtime?.stop();
    } catch (error) {
      this.logger.error(`Falha ao parar "${slot.agent.name}": ${errorMessage(error)}`);
    }
    slot.detachTerminal();
  }

  // ---- inbox ----

  /** Synchronous on purpose: `pumping` must be set before anyone can ask whether the run is quiet. */
  private schedulePump(slot: AgentSlot): void {
    if (slot.pumping) {
      slot.repump = true;
      return;
    }
    slot.pumping = true;
    void this.pump(slot);
  }

  private async pump(slot: AgentSlot): Promise<void> {
    try {
      do {
        slot.repump = false;
        await slot.booted;
        await this.drainInbox(slot);
      } while (slot.repump);
    } catch (error) {
      this.logger.error(`Falha ao entregar a "${slot.agent.name}": ${errorMessage(error)}`);
    } finally {
      // No await between the loop condition and here, so a nudge cannot slip through.
      slot.pumping = false;
      this.settled.emit(slot.runId);
    }
  }

  /** Oldest first, one at a time, for as long as the agent is idle. */
  private async drainInbox(slot: AgentSlot): Promise<void> {
    while (this.stateOf(slot) === "idle") {
      const next = await this.hub.nextPending(slot.runId, slot.agent.name);
      // It may have become busy while the inbox was read; the next idle transition retries.
      if (!next || this.stateOf(slot) !== "idle") return;
      await this.handOver(slot, next);
    }
  }

  private async handOver(slot: AgentSlot, message: MessageRecord): Promise<void> {
    try {
      await this.hub.markDelivered(message);
      await slot.runtime?.deliver({
        id: message.id,
        from: message.from,
        kind: message.kind,
        body: message.body,
        replyTo: message.replyTo,
      });
    } catch (error) {
      // The runtime could not take the message: it stays unacknowledged, the agent is out.
      await this.reportFailure(slot, errorMessage(error));
      return;
    }
    await this.hub.markAcked(message);
  }

  // ---- quiescence ----

  private isIdleNow(runId: string): boolean {
    if (this.hub.openActivity(runId) > 0) return false;
    for (const slot of this.slots.get(runId)?.values() ?? []) {
      if (slot.pumping || ACTIVE_STATES.has(this.stateOf(slot))) return false;
    }
    return true;
  }

  private canStillReceive(runId: string, agentName: string): boolean {
    const slot = this.slots.get(runId)?.get(agentName);
    return !slot || !DEAD_STATES.has(this.stateOf(slot));
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
