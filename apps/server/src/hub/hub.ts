import { Inject, Injectable } from "@nestjs/common";
import type { AgentUsage, ToolCallReport } from "@neurons/agent-runtimes";
import { peersOf, type AgentPeers, type GraphDefinition } from "@neurons/graph-schema";
import type { MessageKind } from "../database/schema/index.js";
import { RunEventRecorder } from "../run-log/run-event-recorder.js";
import { Signal } from "../shared/signal.js";
import type { GuardTrip } from "../guards/guard-trip.js";
import { isExternalAddress } from "./addresses.js";
import { findAgent } from "./agent-lookup.js";
import { HubEvents } from "./hub-events.js";
import {
  AskTimeoutError,
  InvalidMessageError,
  MessageDeniedError,
  MessageNotFoundError,
  RunEndedError,
} from "./hub.errors.js";
import type { MessageRecord } from "./message.js";
import { MessagePolicyChain } from "./message-policy.js";
import { MESSAGE_STORE, type MessageStore } from "./message-store.js";
import { RunRegistry } from "./run-registry.js";

export interface HubOptions {
  /** How long an `ask` waits for its answer when the caller does not say. */
  askTimeoutMs: number;
}

export const HUB_OPTIONS = Symbol("HUB_OPTIONS");

/** What one turn of an agent consumed, after it was written to the log. */
export interface UsageReport {
  runId: string;
  agent: string;
  usage: AgentUsage;
}

/** An agent showed it is alive: it sent, asked, replied, listed its peers, reported usage or finished. */
export interface AgentActivity {
  runId: string;
  agent: string;
}

/** An agent declaring the whole run done. */
export interface FinishRequest {
  runId: string;
  agent: string;
  result: string;
}

interface SendRequest {
  runId: string;
  from: string;
  to: string;
  kind: MessageKind;
  body: string;
  replyTo?: string;
}

interface PendingAsk {
  runId: string;
  /** The agent that asked: it is `waiting_reply` for as long as it has an ask open. */
  asker: string;
  target: string;
  resolve(answer: string): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * The mailman. It never interprets a message nor decides who runs next: it checks the policies,
 * stores the message (with its event, in one transaction) before anything else, announces it for
 * delivery and publishes the events once they are committed.
 *
 * Delivery itself belongs to the Supervisor, which listens to {@link messageRecorded}.
 */
@Injectable()
export class Hub {
  /** A message was stored and is waiting for its recipient. */
  readonly messageRecorded = new Signal<MessageRecord>();
  /** An agent called `finish`. */
  readonly finishRequested = new Signal<FinishRequest>();
  /** An `ask` is no longer open (answered or timed out): the run may have gone quiet. */
  readonly askClosed = new Signal<string>();
  /** Work registered with {@link track} is done: the run may have gone quiet. */
  readonly trackedWorkDone = new Signal<string>();
  /** A message was refused by a guard that also stops the run or an agent. */
  readonly guardTripped = new Signal<GuardTrip>();
  /** An agent's usage was recorded. */
  readonly usageRecorded = new Signal<UsageReport>();
  readonly agentActive = new Signal<AgentActivity>();
  /** An agent opened or closed an `ask`: its count of open asks changed. */
  readonly askChanged = new Signal<AgentActivity>();

  private readonly pendingAsks = new Map<string, PendingAsk>();
  private readonly sendsInFlight = new Map<string, number>();

  constructor(
    @Inject(MESSAGE_STORE) private readonly store: MessageStore,
    @Inject(RunRegistry) private readonly registry: RunRegistry,
    @Inject(MessagePolicyChain) private readonly policies: MessagePolicyChain,
    @Inject(RunEventRecorder) private readonly recorder: RunEventRecorder,
    @Inject(HUB_OPTIONS) private readonly options: HubOptions,
  ) {}

  /**
   * Stores the message and hands it to the recipient (right away when idle, otherwise it waits in
   * the inbox). Resolves once the message is stored, not when it is delivered.
   * @throws RunNotActiveError, InvalidMessageError, MessageNotFoundError or MessageDeniedError.
   */
  send(
    runId: string,
    from: string,
    to: string,
    kind: MessageKind,
    body: string,
    replyTo?: string,
  ): Promise<MessageRecord> {
    return this.dispatch({ runId, from, to, kind, body, ...(replyTo && { replyTo }) });
  }

  /** Sends a question and resolves with the text of the matching reply. */
  ask(
    runId: string,
    from: string,
    to: string,
    question: string,
    timeoutMs: number = this.options.askTimeoutMs,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      // The ask must be registered before the message is announced: the answer may be very fast.
      const register = (message: MessageRecord) => {
        if (!this.registry.find(runId)) {
          // The run ended while the question was being stored: nobody is left to answer it.
          reject(new RunEndedError(runId));
          return;
        }
        const timer = setTimeout(() => this.expireAsk(message.id, timeoutMs), timeoutMs);
        this.pendingAsks.set(message.id, {
          runId,
          asker: from,
          target: to,
          resolve,
          reject,
          timer,
        });
        this.askChanged.emit({ runId, agent: from });
      };
      this.dispatch({ runId, from, to, kind: "ask", body: question }, register).catch(reject);
    });
  }

  /** Answers a received message; the answer goes to whoever wrote it. */
  async reply(
    runId: string,
    from: string,
    messageId: string,
    text: string,
  ): Promise<MessageRecord> {
    const original = await this.store.findById(messageId);
    if (original?.runId !== runId) throw new MessageNotFoundError(messageId);
    return this.dispatch({
      runId,
      from,
      to: original.from,
      kind: "reply",
      body: text,
      replyTo: messageId,
    });
  }

  listPeers(runId: string, agent: string): AgentPeers {
    const { graph } = this.registry.require(runId);
    this.agentActive.emit({ runId, agent });
    return peersOf(graph, agent);
  }

  finish(runId: string, agent: string, result: string): Promise<void> {
    const { graph } = this.registry.require(runId);
    if (!findAgent(graph, agent)) return Promise.reject(unknownAgent("unknown_sender", agent));
    this.agentActive.emit({ runId, agent });
    this.finishRequested.emit({ runId, agent, result });
    return Promise.resolve();
  }

  /**
   * Writes what an agent's turn consumed to the run log. Also accepted while the run winds down:
   * the last turn of an agent reports its usage as the run is closing.
   */
  async reportUsage(runId: string, agent: string, usage: AgentUsage): Promise<void> {
    const { graph } = this.registry.requireOpen(runId);
    if (!findAgent(graph, agent)) throw unknownAgent("unknown_sender", agent);
    await this.recorder.record(runId, [HubEvents.usageRecorded(agent, usage)]);
    this.agentActive.emit({ runId, agent });
    this.usageRecorded.emit({ runId, agent, usage });
  }

  /**
   * Writes that an agent called a tool to the run log. Also accepted while the run winds down, like
   * the usage report: the closing turn of an agent may still use one.
   */
  async reportToolCall(runId: string, agent: string, report: ToolCallReport): Promise<void> {
    const { graph } = this.registry.requireOpen(runId);
    if (!findAgent(graph, agent)) throw unknownAgent("unknown_sender", agent);
    await this.recorder.record(runId, [HubEvents.toolCalled(agent, report)]);
    this.agentActive.emit({ runId, agent });
  }

  /** How many `ask`s the agent has open right now. */
  openAsksOf(runId: string, agent: string): number {
    let count = 0;
    for (const ask of this.pendingAsks.values()) {
      if (ask.runId === runId && ask.asker === agent) count++;
    }
    return count;
  }

  // ---- delivery bookkeeping, used by the Supervisor ----

  /** The recipient is about to receive the message. */
  async markDelivered(message: MessageRecord): Promise<void> {
    await this.store.markDelivered(message.id);
  }

  /** The recipient's runtime confirmed it has the message. */
  async markAcked(message: MessageRecord): Promise<void> {
    const acked = await this.store.markAcked(message.id, HubEvents.messageDelivered);
    if (acked) this.recorder.publish(acked.events);
  }

  nextPending(runId: string, agent: string): Promise<MessageRecord | undefined> {
    return this.store.findNextPending(runId, agent);
  }

  unacked(runId: string): Promise<MessageRecord[]> {
    return this.store.listUnacked(runId);
  }

  /** Sends being stored plus asks waiting for an answer: reasons why the run is not quiet yet. */
  openActivity(runId: string): number {
    let asks = 0;
    for (const ask of this.pendingAsks.values()) if (ask.runId === runId) asks++;
    return (this.sendsInFlight.get(runId) ?? 0) + asks;
  }

  /**
   * Registers work done about something that just happened (a guard judging a usage report): the
   * run is not quiet until it is done, so it cannot end as "quiescent" a moment before a guard
   * would have stopped it. Call it synchronously from the listener that starts the work.
   */
  async track<T>(runId: string, work: Promise<T>): Promise<T> {
    this.sendStarted(runId);
    try {
      return await work;
    } finally {
      this.sendFinished(runId);
      this.trackedWorkDone.emit(runId);
    }
  }

  /** Rejects every open ask of the run (it ended). */
  cancelAsks(runId: string): void {
    for (const [id, ask] of this.pendingAsks) {
      if (ask.runId === runId) this.closeAsk(id)?.reject(new RunEndedError(runId));
    }
  }

  cancelAllAsks(): void {
    for (const [id, ask] of this.pendingAsks)
      this.closeAsk(id)?.reject(new RunEndedError(ask.runId));
  }

  // ---- internals ----

  private async dispatch(
    request: SendRequest,
    onStored?: (message: MessageRecord) => void,
  ): Promise<MessageRecord> {
    const { runId } = request;
    const { graph } = this.registry.require(runId);
    this.sendStarted(runId);
    let askSettled = false;
    try {
      assertWellFormed(request, graph);
      if (!isExternalAddress(request.from)) this.agentActive.emit({ runId, agent: request.from });
      const original = await this.loadOriginal(request);
      await this.enforcePolicies(request, graph, original);

      const external = isExternalAddress(request.to);
      const { record, events } = await this.store.append(
        {
          runId,
          from: request.from,
          to: request.to,
          kind: request.kind,
          replyTo: request.replyTo ?? null,
          body: request.body,
          deliveredOnArrival: external,
        },
        HubEvents.messageSent,
      );
      this.recorder.publish(events);
      onStored?.(record);
      askSettled = await this.route(record, external);
      return record;
    } finally {
      this.sendFinished(runId);
      // After the send no longer counts as activity, or the run could never look quiet.
      if (askSettled) this.askClosed.emit(runId);
    }
  }

  /** A refusal by a guard is not just an error to the sender: the guard's trip is announced too. */
  private async enforcePolicies(
    request: SendRequest,
    graph: GraphDefinition,
    original: MessageRecord | undefined,
  ): Promise<void> {
    try {
      await this.policies.enforce({
        runId: request.runId,
        graph,
        from: request.from,
        to: request.to,
        kind: request.kind,
        body: request.body,
        ...(original && { replyTo: original }),
      });
    } catch (error) {
      if (error instanceof MessageDeniedError && error.trip) {
        this.guardTripped.emit({ runId: request.runId, ...error.trip });
      }
      throw error;
    }
  }

  private async loadOriginal(request: SendRequest): Promise<MessageRecord | undefined> {
    if (!request.replyTo) return undefined;
    const original = await this.store.findById(request.replyTo);
    if (original?.runId !== request.runId) throw new MessageNotFoundError(request.replyTo);
    return original;
  }

  /**
   * An answer to an open `ask` settles it (also when it goes to `@human`, who may have asked);
   * anything else goes to the recipient's inbox, unless the recipient is not an agent.
   * @returns whether an open `ask` was settled.
   */
  private async route(message: MessageRecord, external: boolean): Promise<boolean> {
    const ask =
      message.kind === "reply" && message.replyTo ? this.closeAsk(message.replyTo) : undefined;
    if (!ask) {
      if (!external) this.messageRecorded.emit(message);
      return false;
    }
    ask.resolve(message.body);
    if (!external) await this.markAcked(message);
    return true;
  }

  private expireAsk(askId: string, timeoutMs: number): void {
    const ask = this.closeAsk(askId);
    if (!ask) return;
    ask.reject(new AskTimeoutError(ask.target, timeoutMs));
    this.askClosed.emit(ask.runId);
  }

  private closeAsk(askId: string): PendingAsk | undefined {
    const ask = this.pendingAsks.get(askId);
    if (!ask) return undefined;
    clearTimeout(ask.timer);
    this.pendingAsks.delete(askId);
    this.askChanged.emit({ runId: ask.runId, agent: ask.asker });
    return ask;
  }

  private sendStarted(runId: string): void {
    this.sendsInFlight.set(runId, (this.sendsInFlight.get(runId) ?? 0) + 1);
  }

  private sendFinished(runId: string): void {
    const remaining = (this.sendsInFlight.get(runId) ?? 1) - 1;
    if (remaining > 0) this.sendsInFlight.set(runId, remaining);
    else this.sendsInFlight.delete(runId);
  }
}

const unknownAgent = (code: string, name: string) =>
  new InvalidMessageError(code, `"${name}" não é um agente deste grafo.`);

function assertWellFormed(request: SendRequest, graph: GraphDefinition): void {
  const { from, to, kind, replyTo } = request;
  if (kind === "reply" && !replyTo) {
    throw new InvalidMessageError(
      "reply_without_target",
      "Uma resposta precisa indicar a mensagem que está respondendo.",
    );
  }
  if (kind !== "reply" && replyTo) {
    throw new InvalidMessageError(
      "unexpected_reply_to",
      "Só respostas podem indicar a mensagem respondida.",
    );
  }
  if (!isExternalAddress(from) && !findAgent(graph, from))
    throw unknownAgent("unknown_sender", from);
  // Only an answer may go to `@human`/`@trigger`: nobody starts a conversation with them.
  const knownRecipient = findAgent(graph, to) ?? (kind === "reply" && isExternalAddress(to));
  if (!knownRecipient) throw unknownAgent("unknown_recipient", to);
}
