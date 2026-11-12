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

  it("accepts an optional time zone on a schedule and keeps old triggers valid without it", () => {
    const schedule = { ...trigger("t", "a"), kind: "schedule", cron: "0 9 * * 1" };
    expect(triggerNodeSchema.safeParse(schedule).success).toBe(true);
    expect(
      triggerNodeSchema.safeParse({ ...schedule, timezone: "America/Sao_Paulo" }).success,
    ).toBe(true);
  });

  it("rejects an invalid cron with a pt-BR message and the cron_invalid code", () => {
    const result = triggerNodeSchema.safeParse({
      ...trigger("t", "a"),
      kind: "schedule",
      cron: "toda segunda",
    });
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue).toMatchObject({ path: ["cron"], params: { code: "cron_invalid" } });
    expect(issue?.message).toContain("Expressão cron inválida");
  });

  it("rejects a cron that never fires and an unknown time zone", () => {
    const never = triggerNodeSchema.safeParse({
      ...trigger("t", "a"),
      kind: "schedule",
      cron: "0 0 31 2 *",
    });
    expect(never.success).toBe(false);
    const zone = triggerNodeSchema.safeParse({
      ...trigger("t", "a"),
      kind: "schedule",
      cron: "0 9 * * 1",
      timezone: "Marte/Olympus",
    });
    expect(zone.error?.issues[0]).toMatchObject({
      path: ["timezone"],
      params: { code: "timezone_invalid" },
    });
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
    { kind: "obsidian", vaultPath: "C:\\Notas", readOnly: false },
    { kind: "obsidian", memoryId: "628782b8-1e97-41ce-a6f8-c6034e83b887", readOnly: false },
  ])("accepts the tool %j", (tool) => {
    expect(toolNodeSchema.safeParse(withTool(tool)).success).toBe(true);
  });

  it.each([
    { kind: "obsidian", readOnly: false },
    {
      kind: "obsidian",
      vaultPath: "C:\\Notas",
      memoryId: "628782b8-1e97-41ce-a6f8-c6034e83b887",
      readOnly: true,
    },
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

describe("WhatsApp: trigger, tool and link", () => {
  const whatsappTrigger = {
    ...trigger("t", "a"),
    kind: "whatsapp",
    phoneNumberId: "106540352242922",
    appSecretName: "whatsapp-app-secret",
  };

  it("accepts a WhatsApp trigger that names the number and the App Secret", () => {
    expect(triggerNodeSchema.safeParse(whatsappTrigger).success).toBe(true);
  });

  it("requires the number and the secret name, with a message in Portuguese", () => {
    const withoutNumber = { ...whatsappTrigger, phoneNumberId: undefined };
    const withoutSecret = { ...whatsappTrigger, appSecretName: undefined };
    const noNumber = triggerNodeSchema.safeParse(withoutNumber);
    const noSecret = triggerNodeSchema.safeParse(withoutSecret);
    expect(noNumber.success).toBe(false);
    expect(noSecret.success).toBe(false);
    expect(noNumber.error?.issues[0]?.message).toContain("Phone number ID");
    expect(noSecret.error?.issues[0]?.message).toContain("App Secret");
  });

  it("refuses a number that is not numeric and a secret name that looks like a value", () => {
    expect(
      triggerNodeSchema.safeParse({ ...whatsappTrigger, phoneNumberId: "+55 11 9" }).success,
    ).toBe(false);
    expect(
      triggerNodeSchema.safeParse({ ...whatsappTrigger, appSecretName: "a b/c" }).success,
    ).toBe(false);
  });

  it("keeps the older trigger kinds valid without the WhatsApp fields", () => {
    expect(triggerNodeSchema.safeParse({ ...trigger("t", "a"), kind: "webhook" }).success).toBe(
      true,
    );
  });

  it("accepts the reply tool with the name of the access token secret, never its value", () => {
    const tool = {
      id: "w",
      type: "tool",
      position: { x: 0, y: 0 },
      name: "Resposta",
      tool: {
        kind: "whatsapp",
        phoneNumberId: "106540352242922",
        accessTokenSecret: "whatsapp-token",
      },
    };
    expect(toolNodeSchema.safeParse(tool).success).toBe(true);
    const bad = { ...tool, tool: { ...tool.tool, accessTokenSecret: "EAAG token com espaço" } };
    expect(toolNodeSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts allowWrite on a link and keeps links without it valid", () => {
    const base = { id: "l", from: "a", to: "t", kind: "uses" };
    expect(linkSchema.safeParse(base).success).toBe(true);
    expect(linkSchema.safeParse({ ...base, allowWrite: true }).success).toBe(true);
  });
});
