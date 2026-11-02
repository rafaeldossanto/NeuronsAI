import type { IPty } from "node-pty";

interface WindowsPtyInternals {
  _agent?: {
    inSocket?: { destroy?: () => void };
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
