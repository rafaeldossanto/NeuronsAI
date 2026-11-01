import { Inject, Injectable } from "@nestjs/common";
import { peersOf, type AgentPeers, type GraphDefinition } from "@neurons/graph-schema";
import type { MessageKind } from "../database/schema/index.js";
import { RunEventRecorder } from "../run-log/run-event-recorder.js";
import { Signal } from "../shared/signal.js";
import { isExternalAddress } from "./addresses.js";
import { findAgent } from "./agent-lookup.js";
import { HubEvents } from "./hub-events.js";
import {
  AskTimeoutError,
  InvalidMessageError,
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
        this.pendingAsks.set(message.id, { runId, target: to, resolve, reject, timer });
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
    return peersOf(this.registry.require(runId).graph, agent);
  }

  finish(runId: string, agent: string, result: string): Promise<void> {
    const { graph } = this.registry.require(runId);
    if (!findAgent(graph, agent)) return Promise.reject(unknownAgent("unknown_sender", agent));
    this.finishRequested.emit({ runId, agent, result });
    return Promise.resolve();
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
    try {
      assertWellFormed(request, graph);
      const original = await this.loadOriginal(request);
      await this.policies.enforce({
        runId,
        graph,
        from: request.from,
        to: request.to,
        kind: request.kind,
        body: request.body,
        ...(original && { replyTo: original }),
      });

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
      if (!external) await this.route(record);
      return record;
    } finally {
      this.sendFinished(runId);
    }
  }

  private async loadOriginal(request: SendRequest): Promise<MessageRecord | undefined> {
    if (!request.replyTo) return undefined;
    const original = await this.store.findById(request.replyTo);
    if (original?.runId !== request.runId) throw new MessageNotFoundError(request.replyTo);
    return original;
  }

  /** An answer to an open `ask` settles it; anything else goes to the recipient's inbox. */
  private async route(message: MessageRecord): Promise<void> {
    const ask =
      message.kind === "reply" && message.replyTo ? this.closeAsk(message.replyTo) : undefined;
    if (!ask) {
      this.messageRecorded.emit(message);
      return;
    }
    ask.resolve(message.body);
    await this.markAcked(message);
    this.askClosed.emit(message.runId);
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
