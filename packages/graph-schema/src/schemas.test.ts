import { describe, expect, it } from "vitest";
import { annotationSchema } from "./schemas/annotation.js";
import { linkSchema } from "./schemas/link.js";
import { agentNodeSchema, toolNodeSchema, triggerNodeSchema } from "./schemas/node.js";
import { agent, httpTool, trigger } from "./test-support.js";

const terminalRuntime = { kind: "terminal", cli: "claude", cwd: "C:\\Projetos\\app" };
const withRuntime = (runtime: unknown) => ({ ...agent("a", "A"), runtime });

describe("triggerNodeSchema", () => {
  it("accepts a schedule trigger with cron", () => {
    const input = { ...trigger("t", "a"), kind: "schedule", cron: "0 9 * * 1-5" };
    expect(triggerNodeSchema.safeParse(input).success).toBe(true);
  });

  it("rejects a schedule trigger without cron", () => {
    const result = triggerNodeSchema.safeParse({ ...trigger("t", "a"), kind: "schedule" });
    expect(result.success).toBe(false);
  });

  it("does not require cron for manual triggers", () => {
    expect(triggerNodeSchema.safeParse(trigger("t", "a")).success).toBe(true);
  });
});

describe("agentNodeSchema", () => {
  it.each(["Vendedor", "pos-venda_2", "A"])("accepts the name %s", (name) => {
    expect(agentNodeSchema.safeParse(agent("a", name)).success).toBe(true);
  });

  it.each(["", "1abc", "com espaço", "ação", "a".repeat(41)])("rejects the name %j", (name) => {
    expect(agentNodeSchema.safeParse(agent("a", name)).success).toBe(false);
  });

  it("rejects an unknown effort", () => {
    expect(agentNodeSchema.safeParse({ ...agent("a", "A"), effort: "extreme" }).success).toBe(
      false,
    );
  });

  it("rejects non-positive budget and non-integer idle timeout", () => {
    expect(agentNodeSchema.safeParse({ ...agent("a", "A"), budgetUsd: 0 }).success).toBe(false);
    expect(agentNodeSchema.safeParse({ ...agent("a", "A"), idleTimeoutSec: 1.5 }).success).toBe(
      false,
    );
  });

  it("defaults the terminal mode to pty, so graphs saved before the field keep working", () => {
    const parsed = agentNodeSchema.parse(withRuntime(terminalRuntime));
    expect(parsed.runtime).toMatchObject({ kind: "terminal", mode: "pty" });
  });

  it.each(["pty", "stream-json"])("accepts the terminal mode %s", (mode) => {
    const parsed = agentNodeSchema.parse(withRuntime({ ...terminalRuntime, mode }));
    expect(parsed.runtime).toMatchObject({ kind: "terminal", mode });
  });

  it("rejects an unknown terminal mode", () => {
    const result = agentNodeSchema.safeParse(withRuntime({ ...terminalRuntime, mode: "web" }));
    expect(result.success).toBe(false);
  });

  it("defaults terminal args to an empty list", () => {
    const parsed = agentNodeSchema.parse(withRuntime(terminalRuntime));
    expect(parsed.runtime).toMatchObject({ kind: "terminal", args: [] });
  });

  it.each(["C:\\Projetos\\app", "C:/Projetos/app", "/home/usuario/app", "\\\\servidor\\pasta"])(
    "accepts the absolute cwd %s",
    (cwd) => {
      expect(agentNodeSchema.safeParse(withRuntime({ ...terminalRuntime, cwd })).success).toBe(
        true,
      );
    },
  );

  it.each(["projetos/app", "./app", ""])("rejects the relative cwd %j", (cwd) => {
    expect(agentNodeSchema.safeParse(withRuntime({ ...terminalRuntime, cwd })).success).toBe(false);
  });

  it("requires command for a custom CLI", () => {
    const custom = { ...terminalRuntime, cli: "custom" };
    expect(agentNodeSchema.safeParse(withRuntime(custom)).success).toBe(false);
    expect(
      agentNodeSchema.safeParse(withRuntime({ ...custom, command: "minha-cli" })).success,
    ).toBe(true);
  });
});

describe("toolNodeSchema", () => {
  const withTool = (tool: unknown) => ({ ...httpTool("f"), tool });

  it.each([
    { kind: "mcp", transport: "stdio", command: "npx", args: ["x"], allowedTools: ["ler"] },
    { kind: "mcp", transport: "http", url: "https://mcp.exemplo.com", allowedTools: [] },
    { kind: "http", method: "POST", url: "https://api.exemplo.com", headers: {}, bodySchema: {} },
    { kind: "obsidian", vaultPath: "C:\\Notas", readOnly: true },
  ])("accepts the tool %j", (tool) => {
    expect(toolNodeSchema.safeParse(withTool(tool)).success).toBe(true);
  });

  it.each([
    { kind: "obsidian", vaultPath: "C:\\Notas", readOnly: false },
    { kind: "mcp", transport: "http", url: "nao-e-url", allowedTools: [] },
    { kind: "mcp", transport: "websocket", url: "https://x.com", allowedTools: [] },
    { kind: "http", method: "TRACE", url: "https://api.exemplo.com", headers: {} },
    { kind: "desconhecida" },
  ])("rejects the tool %j", (tool) => {
    expect(toolNodeSchema.safeParse(withTool(tool)).success).toBe(false);
  });
});

describe("linkSchema", () => {
  const base = { id: "l", from: "a", to: "b", kind: "talk" };

  it("defaults bidirectional to false", () => {
    expect(linkSchema.parse(base).bidirectional).toBe(false);
  });

  it("rejects a non-positive or fractional maxMessages", () => {
    expect(linkSchema.safeParse({ ...base, maxMessages: 0 }).success).toBe(false);
    expect(linkSchema.safeParse({ ...base, maxMessages: 2.5 }).success).toBe(false);
    expect(linkSchema.safeParse({ ...base, maxMessages: 5 }).success).toBe(true);
  });
});

describe("annotationSchema", () => {
  const position = { x: 0, y: 0 };

  it("accepts a free arrow with points and a group with members", () => {
    const arrow = { id: "x", kind: "arrow", position, points: [{ x: 1, y: 2 }] };
    const group = { id: "g", kind: "group", position, memberIds: ["a"] };
    expect(annotationSchema.safeParse(arrow).success).toBe(true);
    expect(annotationSchema.safeParse(group).success).toBe(true);
  });

  it("rejects an unknown kind and a non-positive size", () => {
    expect(annotationSchema.safeParse({ id: "x", kind: "star", position }).success).toBe(false);
    const size = { width: 0, height: 10 };
    expect(annotationSchema.safeParse({ id: "x", kind: "rect", position, size }).success).toBe(
      false,
    );
  });
});
