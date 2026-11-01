import { z } from "zod";
import { idSchema, positionSchema } from "./common.js";

const nodeBase = { id: idSchema, position: positionSchema };

export const AGENT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const ABSOLUTE_PATH_PATTERN = /^([A-Za-z]:[\\/]|\\\\|\/)/;

export const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

// ---------- trigger ----------

export const triggerNodeSchema = z
  .object({
    ...nodeBase,
    type: z.literal("trigger"),
    kind: z.enum(["manual", "webhook", "schedule"]),
    target: idSchema,
    cron: z.string().min(1).optional(),
  })
  .refine((trigger) => trigger.kind !== "schedule" || trigger.cron !== undefined, {
    error: "Gatilhos do tipo agenda exigem uma expressão cron.",
    path: ["cron"],
    params: { code: "cron_required" },
  });

// ---------- agent ----------

const apiRuntimeSchema = z.object({
  kind: z.literal("api"),
  provider: z.string().min(1),
  model: z.string().min(1),
});

const terminalRuntimeSchema = z
  .object({
    kind: z.literal("terminal"),
    cli: z.enum(["claude", "codex", "gemini", "custom"]),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    cwd: z.string().regex(ABSOLUTE_PATH_PATTERN, {
      error: "O diretório de trabalho deve ser um caminho absoluto.",
    }),
  })
  .refine((runtime) => runtime.cli !== "custom" || runtime.command !== undefined, {
    error: "CLIs personalizadas exigem o comando a executar.",
    path: ["command"],
    params: { code: "command_required" },
  });

export const agentRuntimeSchema = z.discriminatedUnion("kind", [
  apiRuntimeSchema,
  terminalRuntimeSchema,
]);

export const agentNodeSchema = z.object({
  ...nodeBase,
  type: z.literal("agent"),
  name: z.string().regex(AGENT_NAME_PATTERN, {
    error:
      "O nome do agente deve começar com letra e ter até 40 caracteres (letras, números, _ ou -).",
  }),
  role: z.string(),
  instructions: z.string(),
  effort: effortSchema,
  budgetUsd: z.number().positive().optional(),
  idleTimeoutSec: z.number().int().positive().optional(),
  runtime: agentRuntimeSchema,
});

// ---------- tool ----------

const mcpStdioSchema = z.object({
  kind: z.literal("mcp"),
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()).optional(),
  allowedTools: z.array(z.string()),
});

const mcpHttpSchema = z.object({
  kind: z.literal("mcp"),
  transport: z.literal("http"),
  url: z.url(),
  allowedTools: z.array(z.string()),
});

const httpToolSchema = z.object({
  kind: z.literal("http"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.url(),
  headers: z.record(z.string(), z.string()),
  bodySchema: z.unknown().optional(),
});

const obsidianToolSchema = z.object({
  kind: z.literal("obsidian"),
  vaultPath: z.string().min(1),
  readOnly: z.literal(true),
});

export const toolConfigSchema = z.discriminatedUnion("kind", [
  z.discriminatedUnion("transport", [mcpStdioSchema, mcpHttpSchema]),
  httpToolSchema,
  obsidianToolSchema,
]);

export const toolNodeSchema = z.object({
  ...nodeBase,
  type: z.literal("tool"),
  name: z.string().min(1),
  tool: toolConfigSchema,
});

// ---------- node ----------

export const nodeSchema = z.discriminatedUnion("type", [
  triggerNodeSchema,
  agentNodeSchema,
  toolNodeSchema,
]);

export type TriggerNode = z.infer<typeof triggerNodeSchema>;
export type AgentRuntime = z.infer<typeof agentRuntimeSchema>;
export type AgentNode = z.infer<typeof agentNodeSchema>;
export type ToolConfig = z.infer<typeof toolConfigSchema>;
export type ToolNode = z.infer<typeof toolNodeSchema>;
export type GraphNode = z.infer<typeof nodeSchema>;
