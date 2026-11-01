import type { ToolNode } from "@neurons/graph-schema";
import {
  InMemorySecretResolver,
  type SecretResolver,
  type Tool,
  type ToolCallRecord,
  type ToolContext,
  type ToolResult,
} from "../src/index.js";

type ToolConfig = ToolNode["tool"];

export function toolNode(tool: ToolConfig, name = "Ferramenta"): ToolNode {
  return { id: "tool-1", type: "tool", position: { x: 0, y: 0 }, name, tool };
}

export interface TestContext extends ToolContext {
  calls: ToolCallRecord[];
}

export function testContext(
  overrides: { secrets?: SecretResolver; signal?: AbortSignal } = {},
): TestContext {
  const calls: ToolCallRecord[] = [];
  return {
    calls,
    signal: overrides.signal ?? new AbortController().signal,
    secrets: overrides.secrets ?? new InMemorySecretResolver(),
    onCall: (record) => calls.push(record),
  };
}

export function findTool(tools: Tool[], name: string): Tool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool)
    throw new Error(
      `Ferramenta "${name}" não encontrada em [${tools.map((t) => t.name).join(", ")}]`,
    );
  return tool;
}

export function contentOf(result: ToolResult): string {
  if (!result.ok)
    throw new Error(`Esperava sucesso, veio ${result.error.code}: ${result.error.message}`);
  return result.content;
}

export function errorCodeOf(result: ToolResult): string {
  if (result.ok) throw new Error(`Esperava falha, veio sucesso: ${result.content}`);
  return result.error.code;
}
