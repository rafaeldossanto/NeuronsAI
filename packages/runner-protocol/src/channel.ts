import { decodeRunnerFrame, decodeServerFrame, encodeFrame, type DecodeResult } from "./codec.js";
import type { RunnerFrame, ServerFrame } from "./frames.js";

export type Unsubscribe = () => void;

export interface CloseInfo {
  code: number;
  reason: string;
}

export interface InvalidFrame {
  code: Extract<DecodeResult<never>, { ok: false }>["code"];
  message: string;
}

/**
 * One end of a runner connection: the frames it receives, the frames it sends and the moment the
 * connection ends. The server and the runner only know this; whether it is a WebSocket or an
 * in-memory pair (the runner embedded in the server's process) is decided by whoever builds it.
 */
export interface FrameChannel<In, Out> {
  readonly isOpen: boolean;
  /** Frames go out in order. Sending on a closed channel is a no-op: the peer is gone. */
  send(frame: Out): void;
  onFrame(listener: (frame: In) => void): Unsubscribe;
  onInvalid(listener: (failure: InvalidFrame) => void): Unsubscribe;
  onClose(listener: (info: CloseInfo) => void): Unsubscribe;
  close(code?: number, reason?: string): void;
}

/** The server's end: it receives the runner's frames. */
export type ServerChannel = FrameChannel<RunnerFrame, ServerFrame>;
/** The runner's end: it receives the server's frames. */
export type RunnerChannel = FrameChannel<ServerFrame, RunnerFrame>;

class Listeners<T> {
  private readonly all = new Set<(value: T) => void>();

  add(listener: (value: T) => void): Unsubscribe {
    this.all.add(listener);
    return () => {
      this.all.delete(listener);
    };
  }

  emit(value: T): void {
    for (const listener of [...this.all]) listener(value);
  }
}

/** What a transport must give a {@link WireChannel}: send text, close, and say whether it is open. */
export interface WireIo {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  isOpen(): boolean;
}

/**
 * A channel over a text transport (a WebSocket). The owner feeds it with `receive` (each text frame
 * that arrives) and `notifyClosed` (the socket closed); frames are checked against the protocol
 * on the way in, and a bad one is reported through `onInvalid` instead of being delivered.
 */
export class WireChannel<In, Out> implements FrameChannel<In, Out> {
  private readonly frames = new Listeners<In>();
  private readonly invalid = new Listeners<InvalidFrame>();
  private readonly closes = new Listeners<CloseInfo>();
  private closed = false;

  constructor(
    private readonly io: WireIo,
    private readonly decode: (raw: string) => DecodeResult<In>,
    private readonly encode: (frame: Out) => string,
  ) {}

  get isOpen(): boolean {
    return !this.closed && this.io.isOpen();
  }

  send(frame: Out): void {
    if (this.isOpen) this.io.send(this.encode(frame));
  }

  receive(raw: string): void {
    if (this.closed) return;
    const decoded = this.decode(raw);
    if (decoded.ok) this.frames.emit(decoded.frame);
    else this.invalid.emit({ code: decoded.code, message: decoded.message });
  }

  notifyClosed(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closes.emit({ code, reason });
  }

  close(code?: number, reason?: string): void {
    this.io.close(code, reason);
  }

  onFrame(listener: (frame: In) => void): Unsubscribe {
    return this.frames.add(listener);
  }

  onInvalid(listener: (failure: InvalidFrame) => void): Unsubscribe {
    return this.invalid.add(listener);
  }

  onClose(listener: (info: CloseInfo) => void): Unsubscribe {
    return this.closes.add(listener);
  }
}

export const createServerWireChannel = (io: WireIo): WireChannel<RunnerFrame, ServerFrame> =>
  new WireChannel<RunnerFrame, ServerFrame>(io, decodeRunnerFrame, encodeFrame);

export const createRunnerWireChannel = (io: WireIo): WireChannel<ServerFrame, RunnerFrame> =>
  new WireChannel<ServerFrame, RunnerFrame>(io, decodeServerFrame, encodeFrame);

/** Close code the server uses when it refuses a runner (the WebSocket range for applications). */
export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_NOT_ACCEPTED = 4403;
export const CLOSE_PROTOCOL = 4400;
export const CLOSE_REPLACED = 4409;
export const CLOSE_HEARTBEAT = 4408;

/**
 * Two channels wired to each other in the same process, for the runner embedded in the server
 * (profile `local`) and for tests. Frames still go through the codec, so the embedded runner
 * speaks exactly what a remote one would, and they are delivered in order, never synchronously.
 * Closing either end closes both.
 */
export function createMemoryChannelPair(): { server: ServerChannel; runner: RunnerChannel } {
  // Each end writes to the other, so they are wired after both exist.
  const ends: {
    server?: WireChannel<RunnerFrame, ServerFrame>;
    runner?: WireChannel<ServerFrame, RunnerFrame>;
  } = {};
  let open = true;
  const closeBoth = (code = 1000, reason = ""): void => {
    if (!open) return;
    open = false;
    queueMicrotask(() => {
      ends.server?.notifyClosed(code, reason);
      ends.runner?.notifyClosed(code, reason);
    });
  };
  const server = createServerWireChannel({
    send: (text) => queueMicrotask(() => ends.runner?.receive(text)),
    close: closeBoth,
    isOpen: () => open,
  });
  const runner = createRunnerWireChannel({
    send: (text) => queueMicrotask(() => ends.server?.receive(text)),
    close: closeBoth,
    isOpen: () => open,
  });
  ends.server = server;
  ends.runner = runner;
  return { server, runner };
}
