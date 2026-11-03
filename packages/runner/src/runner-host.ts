import { randomUUID } from "node:crypto";
import {
  isTerminalRuntime,
  silentLogger,
  type AgentCommunication,
  type AgentRuntime,
  type AgentRuntimeFactory,
  type AgentUsage,
  type RuntimeLogger,
  type Unsubscribe,
} from "@neurons/agent-runtimes";
import type { AgentPeers } from "@neurons/graph-schema";
import {
  CLOSE_HEARTBEAT,
  CLOSE_PROTOCOL,
  PROTOCOL_VERSION,
  type AgentDeliverFrame,
  type AgentStartFrame,
  type AgentStopFrame,
  type Call,
  type CallFrame,
  type CallResultFrame,
  type RegisteredFrame,
  type RejectFrame,
  type RunnerChannel,
  type RunnerFrame,
  type ServerFrame,
  type StartSettings,
} from "@neurons/runner-protocol";

/** Builds the runtimes with the settings the server sends along with `agent.start`. */
export type RuntimeFactoryProvider = (settings: StartSettings) => AgentRuntimeFactory;

export interface RunnerHostOptions {
  /** Shown to the server (and in its logs). */
  name: string;
  createFactory: RuntimeFactoryProvider;
  platform?: string;
  logger?: RuntimeLogger;
}

/** How long a stopped agent is remembered, so a repeated `agent.stop` or `agent.start` still gets its answer. */
const FORGET_AFTER_STOP_MS = 60_000;
/** Deliveries remembered per agent to answer a repeated `agent.deliver` without delivering twice. */
const REMEMBERED_DELIVERIES = 500;
/** A peer silent for this many heartbeat intervals is considered gone. */
const MISSED_HEARTBEATS = 3;
const MAX_ERROR_CHARS = 2_000;

interface Instance {
  readonly id: string;
  readonly runtime: AgentRuntime;
  readonly startDone: Promise<void>;
  readonly deliveries: Map<string, Promise<void>>;
  readonly subscriptions: Unsubscribe[];
  stopping: Promise<void> | undefined;
}

interface PendingCall {
  readonly frame: CallFrame;
  readonly instanceId: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/**
 * The runner side of the protocol: hosts the agents' runtimes and relays between them and the
 * server over a {@link RunnerChannel}.
 *
 * The host outlives its connections. When one drops the agents keep running; `attach` gives it the
 * next channel, and the `register` frame that opens every connection lists the agents still alive
 * so the server catches up. Anything the server asked or an agent called that was not answered is
 * repeated safely: requests are answered from what was already done (by `instanceId`, by
 * `message.id`), and calls wait for their result across connections.
 */
export class RunnerHost {
  private readonly logger: RuntimeLogger;
  private readonly instances = new Map<string, Instance>();
  private readonly pendingCalls = new Map<string, PendingCall>();
  private readonly factories = new Map<string, AgentRuntimeFactory>();
  private readonly registeredListeners = new Set<(frame: RegisteredFrame) => void>();
  private readonly rejectedListeners = new Set<(frame: RejectFrame) => void>();

  private channel: RunnerChannel | undefined;
  private channelSubscriptions: Unsubscribe[] = [];
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lastHeardAt = 0;
  /** The agents that existed when the current connection opened: the only ones `keep` can discard. */
  private snapshotIds = new Set<string>();

  constructor(private readonly options: RunnerHostOptions) {
    this.logger = options.logger ?? silentLogger;
  }

  get connected(): boolean {
    return this.channel?.isOpen ?? false;
  }

  /** The ids of the agents this runner hosts (including the ones that already ended). */
  get agentIds(): string[] {
    return [...this.instances.keys()];
  }

  /** The server accepted this connection. */
  onRegistered(listener: (frame: RegisteredFrame) => void): Unsubscribe {
    this.registeredListeners.add(listener);
    return () => {
      this.registeredListeners.delete(listener);
    };
  }

  /** The server refused this runner (a bad token, an unsupported protocol...): reconnecting will not help. */
  onRejected(listener: (frame: RejectFrame) => void): Unsubscribe {
    this.rejectedListeners.add(listener);
    return () => {
      this.rejectedListeners.delete(listener);
    };
  }

  /** Starts talking to the server over a new connection; sends `register` first. */
  attach(channel: RunnerChannel): void {
    this.detach();
    this.channel = channel;
    this.snapshotIds = new Set(this.instances.keys());
    this.channelSubscriptions = [
      channel.onFrame((frame) => this.onFrame(frame)),
      channel.onInvalid((failure) => {
        this.logger.error(`O servidor enviou um frame inválido: ${failure.message}`);
        channel.close(CLOSE_PROTOCOL, failure.message);
      }),
      channel.onClose(() => {
        if (this.channel === channel) this.detach();
      }),
    ];
    this.send({
      v: PROTOCOL_VERSION,
      type: "register",
      runner: {
        name: this.options.name,
        ...(this.options.platform && { platform: this.options.platform }),
      },
      capabilities: { terminal: true, streamJson: true },
      agents: [...this.instances.values()].map((instance) => ({
        instanceId: instance.id,
        state: instance.runtime.state,
        ...(instance.runtime.failureReason && { failureReason: instance.runtime.failureReason }),
      })),
    });
  }

  /** The connection is gone. The agents keep running and the calls keep waiting for the next one. */
  detach(): void {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    for (const unsubscribe of this.channelSubscriptions) unsubscribe();
    this.channelSubscriptions = [];
    this.channel = undefined;
  }

  /** Stops every agent (the runner is shutting down). */
  async stopAll(): Promise<void> {
    await Promise.all([...this.instances.values()].map((instance) => this.stopInstance(instance)));
  }

  // ---- frames from the server ----

  private onFrame(frame: ServerFrame): void {
    this.lastHeardAt = Date.now();
    switch (frame.type) {
      case "registered":
        return this.handleRegistered(frame);
      case "reject":
        this.logger.error(`O servidor recusou este runner (${frame.code}): ${frame.message}`);
        for (const listener of [...this.rejectedListeners]) listener(frame);
        return this.channel?.close();
      case "heartbeat":
        return;
      case "agent.start":
        return this.answer(frame.requestId, () => this.startAgent(frame));
      case "agent.deliver":
        return this.answer(frame.requestId, () => this.deliver(frame));
      case "agent.stop":
        return this.answer(frame.requestId, () => this.stopAgent(frame));
      case "agent.input": {
        const runtime = this.instances.get(frame.instanceId)?.runtime;
        if (runtime && isTerminalRuntime(runtime)) runtime.writeInput(frame.data);
        return;
      }
      case "call.result":
        return this.onCallResult(frame);
    }
  }

  private handleRegistered(frame: RegisteredFrame): void {
    this.lastHeardAt = Date.now();
    const wanted = new Set(frame.keep);
    for (const id of this.snapshotIds) {
      const instance = this.instances.get(id);
      if (instance && !wanted.has(id)) {
        this.logger.warn("Parando um agente que o servidor não quer mais (execução perdida).");
        void this.stopInstance(instance);
      }
    }
    for (const call of this.pendingCalls.values()) this.send(call.frame);

    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(
      () => this.beat(frame.heartbeatIntervalMs),
      frame.heartbeatIntervalMs,
    );
    for (const listener of [...this.registeredListeners]) listener(frame);
  }

  private beat(intervalMs: number): void {
    if (Date.now() - this.lastHeardAt > intervalMs * MISSED_HEARTBEATS) {
      this.logger.warn("O servidor parou de responder; fechando a conexão.");
      this.channel?.close(CLOSE_HEARTBEAT, "sem heartbeat");
      return;
    }
    this.send({ v: PROTOCOL_VERSION, type: "heartbeat" });
  }

  /** Runs the request and answers it on whatever connection is current when it ends. */
  private answer(requestId: string, work: () => Promise<void>): void {
    void work().then(
      () => this.send({ v: PROTOCOL_VERSION, type: "response", requestId, ok: true }),
      (error: unknown) =>
        this.send({
          v: PROTOCOL_VERSION,
          type: "response",
          requestId,
          ok: false,
          error: { message: errorMessage(error).slice(0, MAX_ERROR_CHARS) },
        }),
    );
  }

  // ---- agents ----

  private startAgent(frame: AgentStartFrame): Promise<void> {
    const existing = this.instances.get(frame.instanceId);
    if (existing) return existing.startDone; // the request was repeated after a reconnection

    const runtime = this.factoryFor(frame.settings).create(
      frame.agent,
      new RemoteCommunication(frame.instanceId, this),
    );
    const subscriptions: Unsubscribe[] = [
      runtime.onStateChange((state) =>
        this.send({
          v: PROTOCOL_VERSION,
          type: "agent.state",
          instanceId: frame.instanceId,
          state,
          ...(runtime.failureReason && { failureReason: runtime.failureReason }),
        }),
      ),
    ];
    if (isTerminalRuntime(runtime)) {
      subscriptions.push(
        runtime.onOutput((data) =>
          this.send({
            v: PROTOCOL_VERSION,
            type: "agent.output",
            instanceId: frame.instanceId,
            data,
          }),
        ),
      );
    }
    const startDone = runtime.start(frame.briefing);
    startDone.catch(() => undefined); // answered to the server; must not also be unhandled here
    this.instances.set(frame.instanceId, {
      id: frame.instanceId,
      runtime,
      startDone,
      deliveries: new Map(),
      subscriptions,
      stopping: undefined,
    });
    return startDone;
  }

  private deliver(frame: AgentDeliverFrame): Promise<void> {
    const instance = this.instances.get(frame.instanceId);
    if (!instance) return Promise.reject(new Error("Este runner não hospeda o agente."));

    const known = instance.deliveries.get(frame.message.id);
    if (known) return known; // repeated after a reconnection: never hand over the same message twice

    const delivery = instance.runtime.deliver(frame.message);
    delivery.catch(() => undefined);
    instance.deliveries.set(frame.message.id, delivery);
    if (instance.deliveries.size > REMEMBERED_DELIVERIES) {
      const oldest = instance.deliveries.keys().next();
      if (!oldest.done) instance.deliveries.delete(oldest.value);
    }
    return delivery;
  }

  private stopAgent(frame: AgentStopFrame): Promise<void> {
    const instance = this.instances.get(frame.instanceId);
    return instance ? this.stopInstance(instance) : Promise.resolve();
  }

  private stopInstance(instance: Instance): Promise<void> {
    instance.stopping ??= instance.runtime
      .stop()
      .catch((error: unknown) =>
        this.logger.error(`Falha ao parar um agente: ${errorMessage(error)}`),
      )
      .finally(() => {
        for (const unsubscribe of instance.subscriptions) unsubscribe();
        this.rejectCallsOf(instance.id, "O agente foi encerrado.");
        setTimeout(() => this.instances.delete(instance.id), FORGET_AFTER_STOP_MS).unref();
      });
    return instance.stopping;
  }

  private factoryFor(settings: StartSettings): AgentRuntimeFactory {
    const key = JSON.stringify(settings);
    let factory = this.factories.get(key);
    if (!factory) {
      factory = this.options.createFactory(settings);
      this.factories.set(key, factory);
    }
    return factory;
  }

  // ---- calls to the Hub ----

  /** Called by {@link RemoteCommunication}: waits for the server's result, however many connections it takes. */
  callServer(instanceId: string, call: Call): Promise<unknown> {
    const callId = randomUUID();
    const frame: CallFrame = { v: PROTOCOL_VERSION, type: "call", callId, instanceId, call };
    return new Promise((resolve, reject) => {
      this.pendingCalls.set(callId, { frame, instanceId, resolve, reject });
      this.send(frame);
    });
  }

  private onCallResult(frame: CallResultFrame): void {
    const pending = this.pendingCalls.get(frame.callId);
    if (!pending) return; // already answered through an earlier connection
    this.pendingCalls.delete(frame.callId);
    if (frame.ok) pending.resolve(frame.result);
    else pending.reject(new Error(frame.error?.message ?? "A chamada ao servidor falhou."));
  }

  private rejectCallsOf(instanceId: string, message: string): void {
    for (const [callId, pending] of this.pendingCalls) {
      if (pending.instanceId !== instanceId) continue;
      this.pendingCalls.delete(callId);
      pending.reject(new Error(message));
    }
  }

  private send(frame: RunnerFrame): void {
    this.channel?.send(frame);
  }
}

/** The communication tools of an agent hosted by a runner: each one is a call to the server's Hub. */
class RemoteCommunication implements AgentCommunication {
  constructor(
    private readonly instanceId: string,
    private readonly host: RunnerHost,
  ) {}

  async sendMessage(to: string, text: string): Promise<{ messageId: string }> {
    return (await this.call({ method: "send_message", to, text })) as { messageId: string };
  }

  async ask(to: string, question: string, options?: { timeoutMs?: number }): Promise<string> {
    return (await this.call({
      method: "ask",
      to,
      question,
      ...(options?.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
    })) as string;
  }

  async reply(messageId: string, text: string): Promise<{ messageId: string }> {
    return (await this.call({ method: "reply", messageId, text })) as { messageId: string };
  }

  async listPeers(): Promise<AgentPeers> {
    return (await this.call({ method: "list_peers" })) as AgentPeers;
  }

  async finish(result: string): Promise<void> {
    await this.call({ method: "finish", result });
  }

  async reportUsage(usage: AgentUsage): Promise<void> {
    await this.call({ method: "report_usage", usage });
  }

  private call(call: Call): Promise<unknown> {
    return this.host.callServer(this.instanceId, call);
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
