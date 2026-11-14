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

/** Under the server's per-message limit (`NEURONS_TERMINAL_INPUT_MAX_CHARS`, 4096 by default). */
const TERMINAL_INPUT_CHUNK = 4000;

export interface RunLiveClientOptions {
  runId: string;
  /** `ws://` / `wss://` address of `/ws`. */
  url: string;
  onEvent: (event: RunLiveEvent) => void;
  onConnection: (state: ConnectionState) => void;
  /** An `error` frame from the server (with its `code`), or `null` when the subscription cleared it. */
  onError?: (message: string | null, code?: string) => void;
  /**
   * Refreshes the HttpOnly session cookies (the server checks the cookies of the upgrade request, so
   * an old socket or one opened with an expired cookie is refused with `invalid_session`). Called at
   * most twice in a row; the socket is reopened with the new cookies afterwards.
   */
  renewSession?: () => Promise<void>;
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
  private subscribed = false;
  /** The screen size of each terminal as this viewer reported it: sent again on every (re)subscription. */
  private readonly terminalSizes = new Map<string, { cols: number; rows: number }>();
  private renewals = 0;

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
    this.subscribed = false;
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

  /**
   * Types into the terminal of `agent` (`terminal.input`). The text goes out exactly as given and is
   * never logged or kept: it can be a password. A paste longer than the server accepts per message is
   * split. Returns false when there is no open connection (nothing was sent).
   */
  sendTerminalInput(agent: string, data: string): boolean {
    const socket = this.socket;
    if (!socket || !this.subscribed || data === "") return false;
    for (let i = 0; i < data.length; i += TERMINAL_INPUT_CHUNK) {
      this.send("terminal.input", {
        runId: this.options.runId,
        agent,
        data: data.slice(i, i + TERMINAL_INPUT_CHUNK),
      });
    }
    return true;
  }

  /**
   * Says how big the screen of `agent`'s terminal is here (`terminal.resize`): the server gives the
   * terminal the smallest size among its viewers and answers everyone with the size it took. The
   * size is remembered and sent again after every reconnection, because the server forgets a
   * viewer when its connection closes. Returns false when there is no open connection (the size
   * is still kept for the next one).
   */
  sendTerminalResize(agent: string, cols: number, rows: number): boolean {
    this.terminalSizes.set(agent, { cols, rows });
    const socket = this.socket;
    if (!socket || !this.subscribed) return false;
    this.send("terminal.resize", { runId: this.options.runId, agent, cols, rows });
    return true;
  }

  private handle(raw: unknown): void {
    const frame = parseFrame(raw);
    if (!frame) return;
    const { event, data } = frame;
    if (event === "subscribed") {
      this.subscribed = true;
      this.attempt = 0;
      this.renewals = 0;
      this.options.onError?.(null);
      this.options.onConnection("live");
      for (const [agent, { cols, rows }] of this.terminalSizes) {
        this.send("terminal.resize", { runId: this.options.runId, agent, cols, rows });
      }
    } else if (event === "error") {
      const { message, code } = (data ?? {}) as { message?: unknown; code?: unknown };
      if (code === "invalid_session" && this.options.renewSession && this.renewals < 2) {
        this.renewals += 1;
        this.detach(true);
        const renew = this.options.renewSession;
        void renew()
          .catch(() => undefined)
          .then(() => this.scheduleReconnect(true));
        return;
      }
      this.options.onError?.(
        typeof message === "string" ? message : "Erro do servidor.",
        typeof code === "string" ? code : undefined,
      );
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
    if (!e || e["runId"] !== this.options.runId || typeof e["agent"] !== "string") return;
    if (e["type"] === "TerminalResized") {
      const { cols, rows } = e;
      if (isCells(cols) && isCells(rows))
        this.options.onEvent({ type: "TerminalResized", agent: e["agent"], cols, rows });
      return;
    }
    if (e["type"] === "AgentOutputDelta") {
      const { turnId, channel, delta } = e;
      if (
        typeof turnId === "string" &&
        (channel === "text" || channel === "message") &&
        typeof delta === "string" &&
        delta !== ""
      )
        this.options.onEvent({
          type: "AgentOutputDelta",
          agent: e["agent"],
          turnId,
          channel,
          delta,
        });
      return;
    }
    if (e["type"] !== "TerminalOutput" || typeof e["data"] !== "string") return;
    this.options.onEvent({
      type: "TerminalOutput",
      agent: e["agent"],
      data: e["data"],
      replay: e["replay"] === true,
      ...(isCells(e["cols"]) && isCells(e["rows"]) && { cols: e["cols"], rows: e["rows"] }),
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

const isCells = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

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
