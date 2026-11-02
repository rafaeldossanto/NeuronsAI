import { createRequire } from "node:module";

// Both packages are CommonJS with ambient type declarations; `require` gives the same objects as
// their documentation and defers loading the native binary until a PTY session really starts.
const nodeRequire = createRequire(import.meta.url);

export const loadPty = (): typeof import("node-pty") =>
  nodeRequire("node-pty") as typeof import("node-pty");

export const loadXterm = (): typeof import("@xterm/headless") =>
  nodeRequire("@xterm/headless") as typeof import("@xterm/headless");
