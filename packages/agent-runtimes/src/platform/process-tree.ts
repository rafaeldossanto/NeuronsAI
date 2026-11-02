import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const GRACE_MS = 1_500;
const POLL_MS = 50;

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ends a process and everything it spawned.
 *
 * Windows: `kill()` only reaches the direct child (and `pty.kill()` hangs with a live CLI), so the
 * tree goes down with `taskkill /T /F`. macOS/Linux: the process must be the leader of its own
 * process group (a PTY child is; a plain child needs `detached: true`); the group gets SIGTERM and,
 * if it is still there after a grace period, SIGKILL.
 */
export async function killProcessTree(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === "win32") {
    await run("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }).catch(
      () => undefined, // already gone is the outcome we want
    );
    return;
  }

  signalGroup(pid, "SIGTERM");
  for (let waited = 0; waited < GRACE_MS && isProcessAlive(pid); waited += POLL_MS) {
    await sleep(POLL_MS);
  }
  if (isProcessAlive(pid)) signalGroup(pid, "SIGKILL");
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}
