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
 * `taskkill /T /F`. Elsewhere the SDK does not start the child in its own process group, so the
 * descendants are listed while the parent is still alive (afterwards they are re-parented and
 * lost) and killed together with it.
 */
export async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await run("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }).catch(
      () => undefined, // already gone is the outcome we want
    );
    return;
  }
  const targets = [...(await descendantsOf(pid)), pid];
  for (const target of targets) {
    try {
      process.kill(target, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

/** All descendants of `root` (children, grandchildren...), from one `ps` snapshot. */
async function descendantsOf(root: number): Promise<number[]> {
  const { stdout } = await run("ps", ["-A", "-o", "pid=,ppid="]).catch(() => ({ stdout: "" }));
  const childrenOf = new Map<number, number[]>();
  for (const line of stdout.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || ppid === undefined || Number.isNaN(pid) || Number.isNaN(ppid))
      continue;
    childrenOf.set(ppid, [...(childrenOf.get(ppid) ?? []), pid]);
  }
  const found: number[] = [];
  const queue = [root];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const child of childrenOf.get(next) ?? []) {
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

/** A killed process leaves the table at once; this is only the slack for a loaded machine. */
const SETTLE_MS = 5_000;

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
    if (await waitForExit(pid, SETTLE_MS)) return;
  }
}
