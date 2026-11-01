import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ends a process and everything it spawned. On Windows `kill()` only reaches the direct child
 * (an `npx`/`cmd` wrapper would leave the real server running), so the tree is taken down with
 * `taskkill /T /F`. Elsewhere SIGKILL is enough for the process we started.
 */
export async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await run("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }).catch(
      () => undefined, // already gone is the outcome we want
    );
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

/** Lets `pid` exit on its own for `graceMs`, then takes its whole tree down (retrying if needed). */
export async function ensureGone(pid: number, graceMs: number, attempts: number): Promise<void> {
  if (await waitForExit(pid, graceMs)) return;
  for (let attempt = 0; attempt < attempts; attempt++) {
    await killProcessTree(pid);
    if (await waitForExit(pid, 500)) return;
  }
}
