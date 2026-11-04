import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  isTerminalRuntime,
  type AgentRuntime,
  type AgentRuntimeFactory,
  type AgentRuntimeState,
} from "@neurons/agent-runtimes";
import { peersOf, type AgentNode } from "@neurons/graph-schema";
import { AGENT_RUNTIME_FACTORY } from "../agents/agent-runtime-factory.js";
import { GuardEnforcer } from "../guards/guard-enforcer.js";
import { TerminalSessions } from "../realtime/terminal-sessions.js";
import { RunEventRecorder } from "../run-log/run-event-recorder.js";
import { RUN_REPOSITORY, type RunRepository } from "../run-log/run-repository.js";
import { settlesWithin } from "../shared/settles-within.js";
import { Signal, type Unsubscribe } from "../shared/signal.js";
import { findAgent } from "./agent-lookup.js";
import { lifecycleStateOf, type AgentLifecycleState } from "./agent-state.js";
import { buildBriefing } from "./briefing.js";
import { HubAgentCommunication } from "./hub-agent-communication.js";
import { HubEvents } from "./hub-events.js";
import { Hub } from "./hub.js";
import type { MessageRecord } from "./message.js";
import { RunRegistry } from "./run-registry.js";

type SlotState = AgentRuntimeState | "failed";

/** An agent's runtime was created and is about to boot. */
export interface StartedAgent {
  runId: string;
  agent: AgentNode;
  runtime: AgentRuntime;
}

/** The state of an agent's runtime changed (`failed` also when the agent was taken out by a guard). */
export interface AgentStateChange {
  runId: string;
  agent: string;
  state: SlotState;
}

/** How long a stop waits for the hand-over in progress to be acknowledged. */
const PUMP_SETTLE_MS = 2_000;

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
  /** The runtime is being stopped (or already is); stopping again waits for the same stop. */
  stopping: Promise<void> | undefined;
  /** The latest inbox pump; stopping waits for it so no acknowledgement lands after the run ended. */
  pumpDone: Promise<void>;
  /** The state last written to the log (decided synchronously, so a state is never written twice). */
  lastState: AgentLifecycleState | undefined;
  /** The state events of this agent being written, in order: the log gets them as they happened. */
  logWrites: Promise<unknown>;
}

/**
 * Keeps the live agent sessions of the active runs: starts an agent on the first message it
 * receives and hands over its inbox in order (FIFO) every time it is idle.
 */
@Injectable()
export class Supervisor {
  /** Something happened that may have left the run quiet: nudge whoever checks for the end. */
  readonly settled = new Signal<string>();
  readonly agentStarted = new Signal<StartedAgent>();
  readonly agentStateChanged = new Signal<AgentStateChange>();
  /** Every runtime of the run is stopped. */
  readonly runStopped = new Signal<string>();

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
    @Inject(GuardEnforcer) enforcer: GuardEnforcer,
  ) {
    this.terminals.useRunLookup(this.registry);
    this.hub.messageRecorded.subscribe((message) => this.onMessage(message));
    this.hub.askClosed.subscribe((runId) => this.settled.emit(runId));
    this.hub.trackedWorkDone.subscribe((runId) => this.settled.emit(runId));
    // The count of open asks is the Hub's: an agent with two open stays waiting after the first answer.
    this.hub.askChanged.subscribe(({ runId, agent }) => {
      const slot = this.slots.get(runId)?.get(agent);
      if (slot) this.syncState(slot);
    });
    enforcer.tripped.subscribe((trip) => {
      if (trip.scope === "agent" && trip.agent) {
        return this.abortAgent(trip.runId, trip.agent, trip.reason);
      }
    });
  }

  /**
   * Boot-time recovery: for every running run, hands over again what was never acknowledged
   * (the process died in between), starting the agents that need it.
   */
  async recover(): Promise<void> {
    for (const { run, graph } of await this.runs.listRunning()) {
      this.registry.register(run.id, graph, run.budgetUsd ?? undefined);
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
    const stopped = Promise.all(slots.map((slot) => this.stopSlot(slot))).then(() =>
      this.runStopped.emit(runId),
    );
    this.stopping.set(runId, stopped);
    return stopped.finally(() => this.stopping.delete(runId));
  }

  /**
   * Takes one agent out of the run for good because a guard tripped: the failure is logged with the
   * guard's reason, the runtime is stopped and the run goes on without it.
   */
  async abortAgent(runId: string, agentName: string, reason: string): Promise<void> {
    const slot = this.slots.get(runId)?.get(agentName);
    if (!slot) return;
    await this.reportFailure(slot, reason);
    await this.stopSlot(slot);
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
    this.agentStateChanged.emit({ runId: slot.runId, agent: slot.agent.name, state });
    // A failure is written by `reportFailure`, together with its reason and AgentFailed.
    if (state === "failed") void this.reportFailure(slot, slot.runtime?.failureReason);
    else this.syncState(slot);
    if (state === "idle") this.schedulePump(slot);
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
      stopping: undefined,
      pumpDone: Promise.resolve(),
      lastState: undefined,
      logWrites: Promise.resolve(),
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
      slot.lastState = "starting";
      await this.enqueueWrite(slot, () =>
        this.recorder.record(slot.runId, [
          HubEvents.agentStarted(slot.agent.name, briefing),
          HubEvents.agentStateChanged(slot.agent.name, "starting"),
        ]),
      );
      this.agentStarted.emit({ runId: slot.runId, agent: slot.agent, runtime });
      await runtime.start(briefing);
    } catch (error) {
      await this.reportFailure(slot, errorMessage(error));
    }
  }

  private stateOf(slot: AgentSlot): SlotState {
    if (slot.failed) return "failed";
    return slot.runtime?.state ?? "starting";
  }

  /**
   * What the log says about the agent now. The runtime tells whether it works, the Hub how many
   * `ask`s it has open (so `waiting_reply` does not end with the first answer) and the slot whether
   * it was taken out.
   */
  private lifecycleOf(slot: AgentSlot): AgentLifecycleState {
    if (slot.failed) return "failed";
    const runtime = slot.runtime?.state ?? "starting";
    return lifecycleStateOf(runtime, this.hub.openAsksOf(slot.runId, slot.agent.name));
  }

  /** Writes `AgentStateChanged` when, and only when, the state is not the one already written. */
  private syncState(slot: AgentSlot): void {
    const state = this.lifecycleOf(slot);
    if (state === slot.lastState) return;
    slot.lastState = state;
    this.enqueueWrite(slot, () =>
      this.recorder.record(slot.runId, [HubEvents.agentStateChanged(slot.agent.name, state)]),
    ).catch((error: unknown) =>
      this.logger.error(
        `Não foi possível registrar o estado de "${slot.agent.name}": ${errorMessage(error)}`,
      ),
    );
  }

  /** Runs a write after the ones before it; a failed write does not hold back the next. */
  private enqueueWrite<T>(slot: AgentSlot, write: () => Promise<T>): Promise<T> {
    const written = slot.logWrites.then(write);
    slot.logWrites = written.then(
      () => undefined,
      () => undefined,
    );
    return written;
  }

  private async reportFailure(slot: AgentSlot, reason: string | undefined): Promise<void> {
    if (slot.failed) return;
    slot.failed = true;
    slot.lastState = "failed";
    const text = reason ?? "O agente falhou.";
    try {
      await this.enqueueWrite(slot, () =>
        this.recorder.record(slot.runId, [
          HubEvents.agentFailed(slot.agent.name, text),
          HubEvents.agentStateChanged(slot.agent.name, "failed", text),
        ]),
      );
    } catch (error) {
      this.logger.error(
        `Não foi possível registrar a falha de "${slot.agent.name}": ${errorMessage(error)}`,
      );
    }
    this.agentStateChanged.emit({ runId: slot.runId, agent: slot.agent.name, state: "failed" });
    this.settled.emit(slot.runId);
  }

  private stopSlot(slot: AgentSlot): Promise<void> {
    slot.stopping ??= this.stopRuntime(slot);
    return slot.stopping;
  }

  private async stopRuntime(slot: AgentSlot): Promise<void> {
    slot.unsubscribe();
    await slot.booted;
    try {
      await slot.runtime?.stop();
    } catch (error) {
      this.logger.error(`Falha ao parar "${slot.agent.name}": ${errorMessage(error)}`);
    }
    slot.detachTerminal();
    // The run is over for this agent (a failed one keeps saying so). Written before the run's end.
    this.syncState(slot);
    await slot.logWrites;
    // A message handed over just before the stop is acknowledged before the run is closed.
    // (Bounded: a runtime that never confirms receiving a message must not hold the stop.)
    await settlesWithin(slot.pumpDone, PUMP_SETTLE_MS);
  }

  // ---- inbox ----

  /** Synchronous on purpose: `pumping` must be set before anyone can ask whether the run is quiet. */
  private schedulePump(slot: AgentSlot): void {
    if (slot.pumping) {
      slot.repump = true;
      return;
    }
    slot.pumping = true;
    slot.pumpDone = this.pump(slot);
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
