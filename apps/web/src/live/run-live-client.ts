import type { ConnectionState, RunLiveEvent } from "./types";

/** The slice of the browser `WebSocket` the client uses (a hand-made fake implements it in tests). */
export interface SocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface RunLiveClientOptions {
  runId: string;
  /** `ws://` / `wss://` address of `/ws`. */
  url: string;
  onEvent: (event: RunLiveEvent) => void;
  onConnection: (state: ConnectionState) => void;
  /** A message from the server (`error` frame) or null when it cleared. */
  onError?: (message: string | null) => void;
  createSocket?: (url: string) => SocketLike;
  /** First reconnection delay; doubles on every failed attempt up to `maxDelayMs`. */
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/** Address of `/ws` on the page's own origin (`ws:` on http, `wss:` on https). */
export function defaultSocketUrl(location: Pick<Location, "protocol" | "host">): string {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
}

/**
 * Follows one run over `/ws`. The initial history comes from the same subscription: the first
 * `subscribe` asks `fromSeq: 1`, and the server replays `run_events` from there and then goes live
 * with no gap or duplicate (one channel, so there is no race between a REST page and the socket).
 * After a drop it reconnects with exponential backoff and subscribes again from `lastSeq + 1`.
 * Duplicates and out-of-order events are dropped by `seq`; a gap (a lost event) forces a reconnection
 * so the server re-sends the missing ones. Once the run finishes there is nothing left to follow.
 */
export class RunLiveClient {
  private socket: SocketLike | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private everConnected = false;
  private closed = false;
  private lastSeq = 0;

  private readonly createSocket: (url: string) => SocketLike;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(private readonly options: RunLiveClientOptions) {
    this.createSocket =
      options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 15_000;
  }

  get lastSeenSeq(): number {
    return this.lastSeq;
  }

  start(): void {
    this.connect();
  }

  close(): void {
    this.closed = true;
    this.clearTimer();
    this.detach(true);
    this.options.onConnection("closed");
  }

  private connect(): void {
    if (this.closed) return;
    this.options.onConnection(this.everConnected ? "reconnecting" : "connecting");
    let socket: SocketLike;
    try {
      socket = this.createSocket(this.options.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.everConnected = true;
      this.send("subscribe", { runId: this.options.runId, fromSeq: this.lastSeq + 1 });
    };
    socket.onmessage = (message) => {
      if (this.socket === socket) this.handle(message.data);
    };
    socket.onerror = () => {
      // `close` always follows; reconnecting is decided there.
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.scheduleReconnect();
    };
  }

  private handle(raw: unknown): void {
    const frame = parseFrame(raw);
    if (!frame) return;
    const { event, data } = frame;
    if (event === "subscribed") {
      this.attempt = 0;
      this.options.onError?.(null);
      this.options.onConnection("live");
    } else if (event === "error") {
      const message = (data as { message?: unknown } | null)?.message;
      this.options.onError?.(typeof message === "string" ? message : "Erro do servidor.");
    } else if (event === "run.event") {
      this.handleRunEvent(data);
    } else if (event === "run.ephemeral") {
      this.handleEphemeral(data);
    }
  }

  private handleRunEvent(data: unknown): void {
    const e = data as Record<string, unknown> | null;
    if (!e || e["runId"] !== this.options.runId) return;
    const seq = e["seq"];
    if (typeof seq !== "number" || typeof e["type"] !== "string") return;
    if (seq <= this.lastSeq) return; // duplicate or late
    if (seq > this.lastSeq + 1) {
      // A hole: drop it and resubscribe from the first missing seq.
      this.detach(true);
      this.scheduleReconnect(true);
      return;
    }
    this.lastSeq = seq;
    this.options.onEvent({
      seq,
      type: e["type"],
      agent: typeof e["agent"] === "string" ? e["agent"] : null,
      payload: e["payload"],
      at: typeof e["at"] === "string" ? e["at"] : "",
    });
    if (e["type"] === "RunFinished") this.close();
  }

  private handleEphemeral(data: unknown): void {
    const e = data as Record<string, unknown> | null;
    if (!e || e["runId"] !== this.options.runId || e["type"] !== "TerminalOutput") return;
    if (typeof e["agent"] !== "string" || typeof e["data"] !== "string") return;
    this.options.onEvent({
      type: "TerminalOutput",
      agent: e["agent"],
      data: e["data"],
      replay: e["replay"] === true,
    });
  }

  private scheduleReconnect(immediate = false): void {
    if (this.closed) return;
    this.options.onConnection("reconnecting");
    const delay = immediate
      ? 0
      : Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.min(this.attempt, 30));
    this.attempt += 1;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }

  private send(event: string, data: unknown): void {
    this.socket?.send(JSON.stringify({ event, data }));
  }

  /** Detaches the socket's handlers so a late event of an abandoned socket changes nothing. */
  private detach(closeSocket: boolean): void {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    if (closeSocket) {
      try {
        socket.send(JSON.stringify({ event: "unsubscribe", data: { runId: this.options.runId } }));
      } catch {
        // not open: nothing to unsubscribe from
      }
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

function parseFrame(raw: unknown): { event: string; data: unknown } | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as { event?: unknown; data?: unknown } | null;
    return parsed && typeof parsed.event === "string"
      ? { event: parsed.event, data: parsed.data }
      : null;
  } catch {
    return null;
  }
}
