import { describe, expect, it } from "vitest";
import { UnsupportedRuntimeError } from "../contract/agent-runtime-factory.js";
import {
  RecordingCommunication,
  fakeClaudeCommand,
  terminalAgent,
} from "../testing/fake-claude-support.js";
import { ClaudeStreamJsonRuntime } from "./claude-stream-json-runtime.js";
import { ClaudeTerminalRuntime } from "./claude-terminal-runtime.js";
import { TerminalRuntimeFactory } from "./terminal-runtime-factory.js";

describe("TerminalRuntimeFactory", () => {
  const factory = new TerminalRuntimeFactory({
    askTimeoutMs: 1_000,
    cli: { command: fakeClaudeCommand() },
  });
  const communication = new RecordingCommunication();

  it("builds a PTY runtime by default and a stream-json one on request", () => {
    expect(factory.create(terminalAgent({ mode: "pty" }), communication)).toBeInstanceOf(
      ClaudeTerminalRuntime,
    );
    expect(factory.create(terminalAgent({ mode: "stream-json" }), communication)).toBeInstanceOf(
      ClaudeStreamJsonRuntime,
    );
  });

  it("refuses CLIs other than Claude Code with a clear message", () => {
    const attempt = () => factory.create(terminalAgent({ cli: "codex" }), communication);
    expect(attempt).toThrow(UnsupportedRuntimeError);
    expect(attempt).toThrow(/"codex".*ainda não é suportada/);
  });

  it("refuses agents that are not terminal agents", () => {
    const api = {
      ...terminalAgent(),
      runtime: { kind: "api" as const, provider: "anthropic", model: "x" },
    };
    expect(() => factory.create(api, communication)).toThrow(UnsupportedRuntimeError);
  });

  it("refuses arguments that would undo the runtime's setup, before the agent starts", () => {
    const agent = terminalAgent({ args: ["--dangerously-skip-permissions"] });
    expect(() => factory.create(agent, communication)).toThrow(/não permite/);
  });
});
