import { describe, expect, it } from "vitest";
import { UnsupportedRuntimeError } from "../contract/agent-runtime-factory.js";
import {
  BRIDGE_ENV_NAMES,
  MAX_BRIEFING_CHARS,
  assertAllowedCodexArgs,
  buildCodexArgs,
  codexEffort,
  tomlString,
  type CodexArgsInput,
} from "./codex-args.js";

const base: CodexArgsInput = {
  mode: "stream-json",
  briefing: "# Você é Revisor",
  mcpServer: { command: "C:\\node\\node.exe", args: ["C:\\neurons\\mcp.js"] },
  askTimeoutMs: 5_000,
  userArgs: [],
};

const configEntries = (args: string[]): string[] =>
  args.flatMap((arg, index) => (args[index - 1] === "-c" ? [arg] : []));

describe("tomlString", () => {
  it("writes a TOML basic string: quotes, backslashes, newlines and control characters escaped", () => {
    expect(tomlString('a "b" \\ c\nd\u0001')).toBe('"a \\"b\\" \\\\ c\\nd\\u0001"');
    expect(tomlString("\u007f")).toBe('"\\u007f"');
  });

  it("replaces a lone surrogate, which TOML cannot hold", () => {
    expect(tomlString("a\ud800b")).toBe('"a\ufffdb"');
  });
});

describe("assertAllowedCodexArgs", () => {
  it.each([
    ["--yolo"],
    ["--dangerously-bypass-approvals-and-sandbox"],
    ["--full-auto"],
    ["--approve-for-me"],
    ["--ask-for-approval=never"],
    ["-c"],
    ['--config=sandbox_mode="danger-full-access"'],
    ["--profile"],
    ["--cd"],
    ["--add-dir"],
    ["--json"],
  ])("refuses %s", (flag) => {
    expect(() => assertAllowedCodexArgs("Revisor", [flag])).toThrow(UnsupportedRuntimeError);
  });

  it("refuses a sandbox that is off or unknown, and a repeated one", () => {
    expect(() => assertAllowedCodexArgs("R", ["--sandbox", "danger-full-access"])).toThrow(
      /--sandbox/,
    );
    expect(() => assertAllowedCodexArgs("R", ["--sandbox=nope"])).toThrow(/--sandbox/);
    expect(() =>
      assertAllowedCodexArgs("R", ["-s", "read-only", "--sandbox", "read-only"]),
    ).toThrow(/--sandbox/);
  });

  it("lets the agent choose the read-only or workspace-write sandbox, and harmless flags", () => {
    expect(() =>
      assertAllowedCodexArgs("R", ["--sandbox", "workspace-write", "--no-alt-screen"]),
    ).not.toThrow();
    expect(() => assertAllowedCodexArgs("R", ["-s=read-only"])).not.toThrow();
  });
});

describe("buildCodexArgs", () => {
  it("exec: json events, read-only sandbox, never asking, prompt through stdin", () => {
    const args = buildCodexArgs({ ...base, effort: "low", model: "gpt-5-codex" });
    expect(args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(args).toContain("--skip-git-repo-check");
    expect(args.join(" ")).toContain("--sandbox read-only");
    expect(args.join(" ")).toContain("--model gpt-5-codex");
    expect(args.at(-1)).toBe("-");
    const config = configEntries(args);
    expect(config).toContain('approval_policy="never"');
    expect(config).toContain('model_reasoning_effort="low"');
    expect(config.some((entry) => entry.startsWith("notify="))).toBe(false);
  });

  it("resumes the thread of the first turn, with the options before the subcommand", () => {
    const args = buildCodexArgs({ ...base, resumeThreadId: "0199-thread" });
    expect(args.slice(-3)).toEqual(["resume", "0199-thread", "-"]);
    expect(args.indexOf("--json")).toBeLessThan(args.indexOf("resume"));
    expect(args.lastIndexOf("-c")).toBeLessThan(args.indexOf("resume"));
  });

  it("passes the MCP server by -c, with the bridge token only by environment name", () => {
    const config = configEntries(buildCodexArgs(base));
    expect(config).toContain('mcp_servers.neurons.command="C:\\\\node\\\\node.exe"');
    expect(config).toContain('mcp_servers.neurons.args=["C:\\\\neurons\\\\mcp.js"]');
    expect(config).toContain(
      `mcp_servers.neurons.env_vars=${JSON.stringify([...BRIDGE_ENV_NAMES])}`,
    );
    expect(config).toContain("mcp_servers.neurons.required=true");
    expect(config).toContain("mcp_servers.neurons.tool_timeout_sec=35");
    expect(config).toContain('mcp_servers.neurons.default_tools_approval_mode="approve"');
    expect(config).toContain('developer_instructions="# Você é Revisor"');
    expect(JSON.stringify(config)).not.toMatch(/TOKEN=|Bearer/);
  });

  it("hands an Electron host's environment to the MCP server as an inline table", () => {
    const config = configEntries(
      buildCodexArgs({
        ...base,
        mcpServer: { ...base.mcpServer, env: { ELECTRON_RUN_AS_NODE: "1" } },
      }),
    );
    expect(config).toContain('mcp_servers.neurons.env={"ELECTRON_RUN_AS_NODE"="1"}');
  });

  it("pty: the TUI in a read-only sandbox that asks a person, with the notify program", () => {
    const args = buildCodexArgs({ ...base, mode: "pty", notify: ["node", "C:\\tmp\\notify.mjs"] });
    expect(args).not.toContain("exec");
    expect(args.join(" ")).toContain("--sandbox read-only --ask-for-approval on-request");
    const config = configEntries(args);
    expect(config).toContain('notify=["node","C:\\\\tmp\\\\notify.mjs"]');
    expect(config).toContain("check_for_update_on_startup=false");
    expect(config).not.toContain('approval_policy="never"');
  });

  it("lets the agent's own args choose the sandbox or the model, and puts them last", () => {
    const args = buildCodexArgs({
      ...base,
      model: "ignored",
      userArgs: ["--sandbox", "workspace-write", "--model", "gpt-mini"],
    });
    expect(args.filter((arg) => arg === "--sandbox")).toHaveLength(1);
    expect(args).not.toContain("ignored");
    expect(args.indexOf("--sandbox")).toBeGreaterThan(args.lastIndexOf("-c"));
  });

  it("refuses a briefing the command line cannot carry", () => {
    expect(() => buildCodexArgs({ ...base, briefing: "x".repeat(MAX_BRIEFING_CHARS + 1) })).toThrow(
      /caracteres/,
    );
  });

  it("keeps the highest efforts at high, which every model has", () => {
    expect(codexEffort("max")).toBe("high");
    expect(codexEffort("xhigh")).toBe("high");
    expect(codexEffort("medium")).toBe("medium");
  });
});
