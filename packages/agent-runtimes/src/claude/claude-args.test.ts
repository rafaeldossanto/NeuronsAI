import { describe, expect, it } from "vitest";
import { UnsupportedRuntimeError } from "../contract/agent-runtime-factory.js";
import { assertAllowedUserArgs, buildClaudeArgs } from "./claude-args.js";
import { OutputBuffer } from "./output-buffer.js";
import { formatInboundMessage } from "./inbound-text.js";

const base = { mcpConfigFile: "mcp.json", briefingFile: "briefing.md", userArgs: [] };

describe("buildClaudeArgs", () => {
  it("pre-approves only the five neurons tools, never skipping permissions", () => {
    const args = buildClaudeArgs({ ...base, mode: "pty", settingsFile: "settings.json" });
    const allowed = args[args.indexOf("--allowedTools") + 1];
    expect(allowed?.split(",").sort()).toEqual(
      ["ask", "finish", "list_peers", "reply", "send_message"].map((t) => `mcp__neurons__${t}`).sort(),
    );
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args).toEqual(expect.arrayContaining(["--strict-mcp-config", "--settings", "settings.json"]));
  });

  it("loads only project and local settings, so the user's own settings are never involved", () => {
    const args = buildClaudeArgs({ ...base, mode: "pty" });
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("project,local");
  });

  it("asks for the plain permission mode, unless the agent's args choose another", () => {
    const own = buildClaudeArgs({ ...base, mode: "pty" });
    expect(own.slice(own.indexOf("--permission-mode"), own.indexOf("--permission-mode") + 2)).toEqual(
      ["--permission-mode", "manual"],
    );

    const chosen = buildClaudeArgs({ ...base, mode: "pty", userArgs: ["--permission-mode", "plan"] });
    expect(chosen.filter((arg) => arg === "--permission-mode")).toHaveLength(1);
  });

  it("runs a headless stream-json session without permission prompts", () => {
    const args = buildClaudeArgs({ ...base, mode: "stream-json", maxBudgetUsd: 2 });
    expect(args).toEqual(
      expect.arrayContaining(["-p", "--input-format", "stream-json", "--output-format", "--max-budget-usd", "2"]),
    );
    expect(args[args.indexOf("--permission-prompts") + 1]).toBe("none");
  });

  it("passes the model and other agent args after its own", () => {
    const args = buildClaudeArgs({ ...base, mode: "pty", userArgs: ["--model", "haiku"] });
    expect(args.slice(-2)).toEqual(["--model", "haiku"]);
  });

  it("sets the effort unless the agent's args already choose one", () => {
    expect(buildClaudeArgs({ ...base, mode: "pty", effort: "high" })).toEqual(
      expect.arrayContaining(["--effort", "high"]),
    );
    const own = buildClaudeArgs({ ...base, mode: "pty", effort: "high", userArgs: ["--effort=low"] });
    expect(own.filter((arg) => arg === "--effort")).toEqual([]);
  });
});

describe("assertAllowedUserArgs", () => {
  it.each([
    ["--dangerously-skip-permissions"],
    ["--settings", "x.json"],
    ["--mcp-config=x.json"],
    ["--permission-mode", "bypassPermissions"],
    ["--permission-mode=bypassPermissions"],
  ])("refuses %j", (...args) => {
    expect(() => assertAllowedUserArgs("Ana", args)).toThrow(UnsupportedRuntimeError);
  });

  it("allows the model and other permission modes", () => {
    expect(() =>
      assertAllowedUserArgs("Ana", ["--model", "haiku", "--permission-mode", "acceptEdits"]),
    ).not.toThrow();
  });
});

describe("OutputBuffer", () => {
  it("keeps the latest chunks within the limit, whole", () => {
    const buffer = new OutputBuffer(10);
    for (const chunk of ["aaaa", "bbbb", "cccc", "dddd"]) buffer.push(chunk);
    expect(buffer.snapshot()).toBe("bbbbccccdddd".slice(4)); // "ccccdddd": the two oldest chunks are gone
  });

  it("never drops the only chunk, even when it exceeds the limit", () => {
    const buffer = new OutputBuffer(3);
    buffer.push("abcdef");
    expect(buffer.snapshot()).toBe("abcdef");
  });
});

describe("formatInboundMessage", () => {
  it("tells the model who wrote, the message id and how to answer an ask", () => {
    const text = formatInboundMessage({
      id: "m-9",
      from: "Pesquisador",
      kind: "ask",
      body: "Está certo?",
      replyTo: null,
    });
    expect(text).toContain("Pesquisador");
    expect(text).toContain("m-9");
    expect(text).toContain("reply");
    expect(text.endsWith("Está certo?")).toBe(true);
  });
});
