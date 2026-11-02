// The Claude Code runtimes (PTY and stream-json). Kept apart from the contract entry point because
// loading them pulls in node-pty and the terminal emulator.
export { TerminalRuntimeFactory, type TerminalRuntimeFactoryOptions } from "./terminal-runtime-factory.js";
export { ClaudeTerminalRuntime, DEFAULT_TERMINAL_TIMINGS } from "./claude-terminal-runtime.js";
export type { ClaudeTerminalOptions, TerminalTimings } from "./claude-terminal-runtime.js";
export { ClaudeStreamJsonRuntime } from "./claude-stream-json-runtime.js";
export { ClaudeCli, ClaudeLoginRequiredError } from "./claude-cli.js";
export type { ClaudeCliOptions, ClaudeCommand } from "./claude-cli.js";
export { ClaudeBinaryNotFoundError } from "../platform/claude-binary.js";
export { LocalBridge } from "../bridge/local-bridge.js";
export { buildChildEnv, inheritedVariables } from "../platform/child-env.js";
export { readHostEnvironment, type HostEnvironment } from "../platform/host-environment.js";
