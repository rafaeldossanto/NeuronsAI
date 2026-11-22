// The CLI runtimes (Claude Code and Codex, PTY and stream-json). Kept apart from the contract entry point because
// loading them pulls in node-pty and the terminal emulator.
export {
  TerminalRuntimeFactory,
  type TerminalRuntimeFactoryOptions,
} from "./terminal-runtime-factory.js";
export { ClaudeTerminalRuntime, DEFAULT_TERMINAL_TIMINGS } from "./claude-terminal-runtime.js";
export type { ClaudeTerminalOptions, TerminalTimings } from "./claude-terminal-runtime.js";
export { TerminalScreen, type FooterState } from "./terminal-screen.js";
export { ClaudeStreamJsonRuntime } from "./claude-stream-json-runtime.js";
export { ClaudeCli, ClaudeLoginRequiredError } from "./claude-cli.js";
export type { ClaudeCliOptions, ClaudeCommand } from "./claude-cli.js";
export type { McpServerCommand } from "./session-files.js";
export { ClaudeBinaryNotFoundError } from "../platform/claude-binary.js";
export { LocalBridge } from "../bridge/local-bridge.js";
export { buildChildEnv, inheritedVariables } from "../platform/child-env.js";
export { readHostEnvironment, type HostEnvironment } from "../platform/host-environment.js";
export { CodexCli, CodexLoginRequiredError, CodexWrongLoginError } from "../codex/codex-cli.js";
export type {
  CodexCliOptions,
  CodexCommand,
  CodexLoginMethod,
  CodexLoginStatus,
} from "../codex/codex-cli.js";
export { CodexExecRuntime } from "../codex/codex-exec-runtime.js";
export { CodexTerminalRuntime } from "../codex/codex-terminal-runtime.js";
export { CodexBinaryNotFoundError } from "../platform/codex-binary.js";
