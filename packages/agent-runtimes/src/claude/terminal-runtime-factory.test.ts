import { describe, expect, it } from "vitest";
import { UnsupportedRuntimeError } from "../contract/agent-runtime-factory.js";
import { CodexExecRuntime } from "../codex/codex-exec-runtime.js";
import { CodexTerminalRuntime } from "../codex/codex-terminal-runtime.js";
import {
  RecordingCommunication,
  fakeClaudeCommand,
  terminalAgent,
} from "../testing/fake-claude-support.js";
import { fakeCodexCommand } from "../testing/fake-codex-support.js";
import { ClaudeStreamJsonRuntime } from "./claude-stream-json-runtime.js";
import { ClaudeTerminalRuntime } from "./claude-terminal-runtime.js";
import { TerminalRuntimeFactory } from "./terminal-runtime-factory.js";

describe("TerminalRuntimeFactory", () => {
  const factory = new TerminalRuntimeFactory({
    askTimeoutMs: 1_000,
    cli: { command: fakeClaudeCommand() },
    codex: { command: fakeCodexCommand() },
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

  it('builds the Codex runtimes for cli "codex", a PTY or an exec session', () => {
    expect(
      factory.create(terminalAgent({ cli: "codex", mode: "pty" }), communication),
    ).toBeInstanceOf(CodexTerminalRuntime);
    expect(
      factory.create(terminalAgent({ cli: "codex", mode: "stream-json" }), communication),
    ).toBeInstanceOf(CodexExecRuntime);
  });

  it("refuses CLIs other than Claude Code and Codex with a clear message", () => {
    for (const cli of ["gemini", "custom"] as const) {
      const attempt = () => factory.create(terminalAgent({ cli }), communication);
      expect(attempt).toThrow(UnsupportedRuntimeError);
      expect(attempt).toThrow(new RegExp(`"${cli}".*ainda não é suportada`));
    }
  });

  it("refuses Codex arguments that would open the sandbox, before the agent starts", () => {
    for (const args of [["--yolo"], ["--sandbox", "danger-full-access"], ["-c", "x=1"]]) {
      const agent = terminalAgent({ cli: "codex", args });
      expect(() => factory.create(agent, communication)).toThrow(/não permite/);
    }
  });

  it("takes an API key for Codex only in the stream-json mode (the TUI would have to save it)", () => {
    const withKey = new TerminalRuntimeFactory({
      apiKey: "sk-test-not-real",
      askTimeoutMs: 1_000,
      codex: { command: fakeCodexCommand() },
    });
    const agent = (mode: "pty" | "stream-json") => ({
      ...terminalAgent({ cli: "codex", mode }),
      runtime: { ...terminalAgent({ cli: "codex", mode }).runtime, access: "api-key" as const },
    });
    expect(() => withKey.create(agent("pty"), communication)).toThrow(/stream-json/);
    expect(withKey.create(agent("stream-json"), communication)).toBeInstanceOf(CodexExecRuntime);
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
