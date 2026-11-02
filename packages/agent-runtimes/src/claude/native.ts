import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Both packages are CommonJS with ambient type declarations; `require` gives the same objects as
// their documentation and defers loading the native binary until a PTY session really starts.
const nodeRequire = createRequire(import.meta.url);

let spawnHelperChecked = false;

/**
 * On macOS and Linux node-pty starts the child through a `spawn-helper` binary. Package managers
 * may unpack it without the execute bit, and then every spawn fails with `posix_spawnp failed`
 * (seen on the macOS CI runner), so the bit is set once before the first PTY.
 */
function ensureSpawnHelperExecutable(): void {
  if (spawnHelperChecked || process.platform === "win32") return;
  spawnHelperChecked = true;
  const root = path.dirname(nodeRequire.resolve("node-pty/package.json"));
  for (const folder of [`prebuilds/${process.platform}-${process.arch}`, "build/Release"]) {
    try {
      chmodSync(path.join(root, folder, "spawn-helper"), 0o755);
    } catch {
      // not there (the other folder has it), or not ours to change: spawning will say so
    }
  }
}

export const loadPty = (): typeof import("node-pty") => {
  ensureSpawnHelperExecutable();
  return nodeRequire("node-pty") as typeof import("node-pty");
};

export const loadXterm = (): typeof import("@xterm/headless") =>
  nodeRequire("@xterm/headless") as typeof import("@xterm/headless");
