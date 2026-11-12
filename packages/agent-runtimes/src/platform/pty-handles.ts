import type { IPty } from "node-pty";

const BROKEN_PIPE_CODES = new Set(["EPIPE", "ECONNRESET"]);

/** A write to the pseudo-terminal after its child process is gone: nothing to deliver, nothing to report. */
export function isBrokenPipe(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return code !== undefined && BROKEN_PIPE_CODES.has(code);
}

interface ErrorSource {
  on?: (event: "error", listener: (error: unknown) => void) => unknown;
  listenerCount?: (event: "error") => number;
}

interface WindowsPtyInternals {
  _socket?: ErrorSource;
  _agent?: {
    inSocket?: { destroy?: () => void } & ErrorSource;
    _conoutSocketWorker?: { dispose?: () => Promise<void> | void };
  };
}

/**
 * On Windows, node-pty leaves two things open after the process is killed with `taskkill` (its own
 * `kill()` hangs, see process-tree.ts): the write side of the pseudo-console pipe and the worker
 * thread that reads its output. Either one alone keeps the Node process alive, so a server told to
 * shut down would never exit. There is no public way to close them, hence the guarded look at the
 * internals; where they differ (macOS and Linux have neither) nothing happens.
 */
export function releasePtyHandles(pty: IPty): void {
  const agent = (pty as unknown as WindowsPtyInternals)._agent;
  agent?.inSocket?.destroy?.();
  void agent?._conoutSocketWorker?.dispose?.();
}

/**
 * node-pty writes through a socket and reports a write after the child exited (or after a kill) as
 * an asynchronous `error` event on that socket. Nobody listens, so Node turns it into an uncaught
 * `EPIPE` that takes the whole process (or the test run) down. This listens and drops only the
 * broken-pipe errors; any other error is left to whoever handled it before, and rethrown when nobody did. Same guarded look at the internals as
 * `releasePtyHandles`: where a socket is absent nothing happens.
 */
export function guardPtyWrites(pty: IPty): void {
  const internals = pty as unknown as WindowsPtyInternals;
  const guard = (source: ErrorSource | undefined): void => {
    source?.on?.("error", (error: unknown) => {
      if (isBrokenPipe(error)) return;
      // node-pty's own listener (Unix: `_socket`, which ignores the EIO of a closed terminal) owns
      // every other error; only when this one is alone does the error stay as unhandled as before.
      if ((source.listenerCount?.("error") ?? 1) > 1) return;
      throw error;
    });
  };
  guard(internals._socket);
  guard(internals._agent?.inSocket);
}
