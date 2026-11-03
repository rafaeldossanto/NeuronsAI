import {
  CLOSE_NOT_ACCEPTED,
  CLOSE_PROTOCOL,
  CLOSE_UNAUTHORIZED,
  createRunnerWireChannel,
  type RejectFrame,
} from "@neurons/runner-protocol";
import { WebSocket } from "ws";
import type { RunnerHost } from "./runner-host.js";

export interface ReconnectPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RECONNECT: ReconnectPolicy = { initialDelayMs: 500, maxDelayMs: 15_000 };

/** Close codes after which trying again is pointless: the server said no. */
const FINAL_CLOSE_CODES: ReadonlySet<number> = new Set([
  CLOSE_UNAUTHORIZED,
  CLOSE_NOT_ACCEPTED,
  CLOSE_PROTOCOL,
]);

export interface RunnerConnectionOptions {
  /** `ws://` or `wss://` address of the server's runner endpoint. */
  url: string;
  /** Sent as `Authorization: Bearer` on the upgrade request, never in the address. */
  token: string;
  host: RunnerHost;
  reconnect?: ReconnectPolicy;
  handshakeTimeoutMs?: number;
  onStatus?: (status: ConnectionStatus) => void;
}

export type ConnectionStatus =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "disconnected"; retryInMs: number }
  | { kind: "refused"; code: RejectFrame["code"] | "closed"; message: string };

/**
 * Keeps the runner connected to the server: opens the connection (outbound, so it works behind
 * NAT), hands each one to the {@link RunnerHost} and, when it drops, tries again with a growing
 * delay. The agents keep running meanwhile. Gives up only when the server refuses the runner.
 */
export class RunnerConnection {
  private socket: WebSocket | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private delayMs: number;
  private stopped = false;
  private refused = false;
  private readonly policy: ReconnectPolicy;

  constructor(private readonly options: RunnerConnectionOptions) {
    this.policy = options.reconnect ?? DEFAULT_RECONNECT;
    this.delayMs = this.policy.initialDelayMs;
    options.host.onRegistered(() => {
      this.delayMs = this.policy.initialDelayMs; // the connection held: the next failure starts over
      this.options.onStatus?.({ kind: "connected" });
    });
    options.host.onRejected((frame) => {
      this.refused = true;
      this.options.onStatus?.({ kind: "refused", code: frame.code, message: frame.message });
    });
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  /** Closes the connection for good. The agents are not stopped (see `RunnerHost.stopAll`). */
  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close(1000, "runner encerrando");
    this.socket = undefined;
  }

  /** Drops the current connection as a network failure would (the runner then reconnects). */
  drop(): void {
    this.socket?.terminate();
  }

  private connect(): void {
    if (this.stopped || this.refused) return;
    this.options.onStatus?.({ kind: "connecting" });
    const socket = new WebSocket(this.options.url, {
      headers: { authorization: `Bearer ${this.options.token}` },
      handshakeTimeout: this.options.handshakeTimeoutMs ?? 10_000,
    });
    this.socket = socket;

    const channel = createRunnerWireChannel({
      send: (text) => socket.send(text),
      close: (code, reason) => socket.close(code, reason),
      isOpen: () => socket.readyState === WebSocket.OPEN,
    });
    socket.on("open", () => this.options.host.attach(channel));
    socket.on("message", (data, isBinary) => {
      if (!isBinary) channel.receive(rawToText(data));
    });
    // A failed attempt raises "error" and then "close"; only "close" decides what happens next.
    socket.on("error", () => undefined);
    socket.on("close", (code, reason) => {
      channel.notifyClosed(code, reason.toString("utf8"));
      if (this.socket === socket) this.socket = undefined;
      if (this.stopped) return;
      if (FINAL_CLOSE_CODES.has(code)) {
        this.refused = true;
        this.options.onStatus?.({
          kind: "refused",
          code: "closed",
          message: reason.toString("utf8") || `O servidor encerrou a conexão (${code}).`,
        });
        return;
      }
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.refused) return;
    const retryInMs = this.delayMs;
    this.delayMs = Math.min(this.delayMs * 2, this.policy.maxDelayMs);
    this.options.onStatus?.({ kind: "disconnected", retryInMs });
    this.timer = setTimeout(() => this.connect(), retryInMs);
  }
}

function rawToText(data: import("ws").RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data as ArrayBuffer).toString("utf8");
}
