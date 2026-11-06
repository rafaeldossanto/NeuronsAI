import { randomUUID } from "node:crypto";
import {
  CLOSE_HEARTBEAT,
  CLOSE_PROTOCOL,
  CLOSE_REPLACED,
  PROTOCOL_REVISION,
  PROTOCOL_VERSION,
  REVISION_TERMINAL_RESIZE,
  type CallFrame,
  type InstanceSnapshot,
  type RegisterFrame,
  type RequestFrame,
  type ResponseFrame,
  type RunnerFrame,
  type ServerChannel,
} from "@neurons/runner-protocol";
import type { RunnerLimits } from "../shared/config/app-config.js";
import { Signal, type Unsubscribe } from "../shared/signal.js";
import {
  type CallOutcome,
  type RemoteAgentRuntime,
  type RunnerEndpoint,
} from "./remote-agent-runtime.js";
import { RunnerLostError } from "./runners.errors.js";
import type { RunnerIdentity } from "./runner-tokens.service.js";

/** Where the link reports what an operator should know. Never receives tokens or message bodies. */
export interface LinkLogger {
  log(message: string): void;
  warn(message: string): void;
}

/** A peer silent for this many heartbeat intervals is considered gone. */
const MISSED_HEARTBEATS = 3;
/** Results of finished calls kept to answer a call the runner repeats after a reconnection. */
const REMEMBERED_CALLS = 2_000;

interface PendingRequest {
  readonly frame: RequestFrame;
  readonly instanceId: string;
  resolve(): void;
  reject(error: Error): void;
}

interface CallRecord {
  readonly outcome: Promise<CallOutcome>;
  done: boolean;
}

/**
 * Everything the server knows about one runner, which outlives its connections. The agents it
 * hosts are {@link RemoteAgentRuntime}s bound here; a connection that drops does not fail them:
 * the link waits `graceMs` for the runner to come back, keeps the requests nobody answered and
 * sends them again on the next connection, and answers a call the runner repeats with the outcome
 * of the first run. Only when the grace period ends do the agents fail.
 */
export class RunnerLink implements RunnerEndpoint {
  /** `true` when a connection was established, `false` when it was lost. */
  readonly connectionChanged = new Signal<boolean>();

  private channel: ServerChannel | undefined;
  private subscriptions: Unsubscribe[] = [];
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastHeardAt = 0;
  /** The grace period ended without the runner coming back. */
  private lost = false;
  private peerRevision = 1;
  get revision() {
    return this.peerRevision;
  }

  private readonly runtimes = new Map<string, RemoteAgentRuntime>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly calls = new Map<string, CallRecord>();

  constructor(
    readonly identity: RunnerIdentity,
    private readonly limits: RunnerLimits,
    private readonly logger: LinkLogger,
  ) {}

  get name(): string {
    return this.identity.name;
  }

  get connected(): boolean {
    return this.channel?.isOpen ?? false;
  }

  /** How many agents it hosts: used to spread new ones over the runners. */
  get load(): number {
    return this.runtimes.size;
  }

  // ---- connection ----

  /** A connection of this runner was accepted; `register` is its first frame. */
  attach(channel: ServerChannel, register: RegisterFrame): void {
    this.peerRevision = register.revision ?? 1;
    this.dropChannel(CLOSE_REPLACED, "outra conexão do mesmo runner assumiu");
    clearTimeout(this.graceTimer);
    this.lost = false;
    this.channel = channel;
    this.lastHeardAt = Date.now();
    this.subscriptions = [
      channel.onFrame((frame) => this.onFrame(frame)),
      channel.onInvalid((failure) => {
        this.logger.warn(`O runner "${this.name}" enviou um frame inválido: ${failure.message}`);
        channel.close(CLOSE_PROTOCOL, failure.message);
      }),
      channel.onClose(() => this.onClosed(channel)),
    ];

    this.reconcile(register.agents);
    channel.send({
      v: PROTOCOL_VERSION,
      type: "registered",
      runnerId: this.identity.id,
      revision: PROTOCOL_REVISION,
      heartbeatIntervalMs: this.limits.heartbeatMs,
      keep: [...this.runtimes.keys()],
    });
    // What the runner never answered goes again, in the order it was asked.
    for (const request of this.pending.values()) channel.send(request.frame);

    this.heartbeat = setInterval(() => this.beat(), this.limits.heartbeatMs);
    this.heartbeat.unref();
    this.connectionChanged.emit(true);
  }

  /** Closes the connection and forgets the timers (server shutdown). */
  dispose(): void {
    clearTimeout(this.graceTimer);
    this.dropChannel(1001, "servidor encerrando");
    for (const request of this.pending.values()) request.reject(new Error("O servidor encerrou."));
    this.pending.clear();
  }

  private dropChannel(code: number, reason: string): void {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions = [];
    const channel = this.channel;
    this.channel = undefined;
    channel?.close(code, reason);
  }

  private onClosed(channel: ServerChannel): void {
    if (this.channel !== channel) return;
    this.dropChannel(1006, "conexão perdida");
    this.logger.warn(
      `O runner "${this.name}" perdeu a conexão; aguardando até ${Math.round(this.limits.graceMs / 1000)} s para voltar.`,
    );
    this.graceTimer = setTimeout(() => this.expire(), this.limits.graceMs);
    this.graceTimer.unref();
    this.connectionChanged.emit(false);
  }

  /** The runner did not come back: its agents are gone as far as the Hub is concerned. */
  private expire(): void {
    this.lost = true;
    const reason = `não voltou a se conectar em ${Math.round(this.limits.graceMs / 1000)} s.`;
    this.logger.warn(`O runner "${this.name}" ${reason}`);
    for (const runtime of this.runtimes.values()) {
      runtime.connectionLost(`O runner "${this.name}" ${reason}`);
    }
    for (const request of this.pending.values()) {
      request.reject(new RunnerLostError(this.name, reason));
    }
    this.pending.clear();
  }

  private beat(): void {
    if (Date.now() - this.lastHeardAt > this.limits.heartbeatMs * MISSED_HEARTBEATS) {
      this.logger.warn(`O runner "${this.name}" parou de responder.`);
      this.channel?.close(CLOSE_HEARTBEAT, "sem heartbeat");
      return;
    }
    this.channel?.send({ v: PROTOCOL_VERSION, type: "heartbeat" });
  }

  /**
   * A new connection tells which agents the runner still hosts. Their states catch up; one the
   * runner no longer has (it restarted) is lost unless its start is still waiting to be sent.
   */
  private reconcile(reported: readonly InstanceSnapshot[]): void {
    const byId = new Map(reported.map((agent) => [agent.instanceId, agent]));
    const starting = new Set(
      [...this.pending.values()]
        .filter((request) => request.frame.type === "agent.start")
        .map((request) => request.instanceId),
    );
    for (const [instanceId, runtime] of this.runtimes) {
      const snapshot = byId.get(instanceId);
      if (snapshot) runtime.applyRemoteState(snapshot.state, snapshot.failureReason);
      else if (!starting.has(instanceId)) {
        runtime.connectionLost(`O runner "${this.name}" perdeu o agente (reiniciou?).`);
      }
    }
  }

  // ---- RunnerEndpoint ----

  bind(runtime: RemoteAgentRuntime): void {
    this.runtimes.set(runtime.instanceId, runtime);
  }

  unbind(instanceId: string): void {
    this.runtimes.delete(instanceId);
  }

  request(build: (requestId: string) => RequestFrame, instanceId: string): Promise<void> {
    if (this.lost && !this.channel) {
      return Promise.reject(new RunnerLostError(this.name, "está desconectado."));
    }
    const frame = build(randomUUID());
    return new Promise((resolve, reject) => {
      this.pending.set(frame.requestId, { frame, instanceId, resolve, reject });
      this.channel?.send(frame);
    });
  }

  sendInput(instanceId: string, data: string): boolean {
    if (!this.channel?.isOpen) return false;
    this.channel.send({ v: PROTOCOL_VERSION, type: "agent.input", instanceId, data });
    return true;
  }

  sendResize(instanceId: string, cols: number, rows: number): boolean {
    // A runner of an older revision would refuse the frame and the connection with it.
    if (!this.channel?.isOpen || this.peerRevision < REVISION_TERMINAL_RESIZE) return false;
    this.channel.send({ v: PROTOCOL_VERSION, type: "agent.resize", instanceId, cols, rows });
    return true;
  }

  // ---- frames from the runner ----

  private onFrame(frame: RunnerFrame): void {
    this.lastHeardAt = Date.now();
    switch (frame.type) {
      case "heartbeat":
        return;
      case "agent.state":
        return this.runtimes
          .get(frame.instanceId)
          ?.applyRemoteState(frame.state, frame.failureReason);
      case "agent.output":
        return this.runtimes.get(frame.instanceId)?.applyOutput(frame.data);
      case "agent.resized":
        return this.runtimes.get(frame.instanceId)?.applyResized(frame.cols, frame.rows);
      case "call":
        return this.onCall(frame);
      case "response":
        return this.onResponse(frame);
      case "register":
        // Only the first frame of a connection is `register`.
        this.channel?.close(CLOSE_PROTOCOL, "register repetido");
    }
  }

  private onResponse(frame: ResponseFrame): void {
    const request = this.pending.get(frame.requestId);
    if (!request) return; // answered through an earlier connection
    this.pending.delete(frame.requestId);
    if (frame.ok) request.resolve();
    else request.reject(new Error(frame.error?.message ?? "O runner recusou o pedido."));
  }

  private onCall(frame: CallFrame): void {
    let record = this.calls.get(frame.callId);
    if (!record) {
      record = this.runCall(frame);
      this.calls.set(frame.callId, record);
      this.forgetOldCalls();
    }
    void record.outcome.then((outcome) => {
      this.channel?.send({
        v: PROTOCOL_VERSION,
        type: "call.result",
        callId: frame.callId,
        ok: outcome.ok,
        ...(outcome.ok
          ? { result: outcome.result ?? null }
          : { error: { message: outcome.message } }),
      });
    });
  }

  private runCall(frame: CallFrame): CallRecord {
    const runtime = this.runtimes.get(frame.instanceId);
    const outcome: Promise<CallOutcome> = runtime
      ? runtime.execute(frame.call).then(
          (result): CallOutcome => ({ ok: true, result }),
          (error: unknown): CallOutcome => ({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }),
        )
      : Promise.resolve({ ok: false, message: "Agente desconhecido neste servidor." });
    const record: CallRecord = { outcome, done: false };
    void outcome.then(() => {
      record.done = true;
    });
    return record;
  }

  private forgetOldCalls(): void {
    if (this.calls.size <= REMEMBERED_CALLS) return;
    for (const [callId, record] of this.calls) {
      if (this.calls.size <= REMEMBERED_CALLS) return;
      if (record.done) this.calls.delete(callId);
    }
  }
}
