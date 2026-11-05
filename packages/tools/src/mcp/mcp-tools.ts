import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ToolSetupError } from "../core/errors.js";
import type { ResolvedDeps, ToolNodeOf } from "../core/registry.js";
import { abortFailure, failure, success } from "../core/results.js";
import type { JsonSchema, Tool, ToolContext, ToolResult, ToolSet } from "../core/types.js";
import { createTransport } from "./transport.js";

const CLIENT_INFO = { name: "neurons-ai", version: "0.0.0" };
const ERROR_PREVIEW_CHARS = 500;

interface RemoteTool {
  name: string;
  description?: string;
  inputSchema: unknown;
}

interface RemoteContent {
  type: string;
  text?: string;
  mimeType?: string;
  uri?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderContent(part: RemoteContent): string {
  switch (part.type) {
    case "text":
      return part.text ?? "";
    case "resource_link":
      return `[recurso: ${part.uri ?? "?"}]`;
    default:
      return `[conteúdo ${part.type}${part.mimeType ? ` (${part.mimeType})` : ""} omitido]`;
  }
}

/** `callTool` also has a legacy result shape without `content`, hence the loose typing. */
function toToolResult(result: Record<string, unknown>): ToolResult {
  const parts = Array.isArray(result.content) ? (result.content as RemoteContent[]) : [];
  const text = parts.map(renderContent).join("\n");
  if (result.isError === true) {
    return failure("MCP_ERROR", text.slice(0, ERROR_PREVIEW_CHARS) || "A ferramenta MCP falhou.");
  }
  if (text === "" && result.structuredContent !== undefined) {
    return success(JSON.stringify(result.structuredContent));
  }
  return success(text);
}

async function listAllTools(client: Client): Promise<RemoteTool[]> {
  const tools: RemoteTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

function remoteTool(client: Client, remote: RemoteTool): Tool {
  return {
    name: remote.name,
    description: remote.description ?? "",
    inputSchema: remote.inputSchema as JsonSchema,
    async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
      if (!isRecord(input)) return failure("INVALID_INPUT", "A entrada deve ser um objeto.");
      try {
        const result = await client.callTool({ name: remote.name, arguments: input }, undefined, {
          signal: ctx.signal,
        });
        return toToolResult(result);
      } catch (error) {
        if (ctx.signal.aborted) return abortFailure(ctx.signal);
        const reason = error instanceof Error ? error.message : String(error);
        return failure("MCP_ERROR", `Falha ao chamar "${remote.name}" no servidor MCP: ${reason}`);
      }
    },
  };
}

export async function createMcpTools(
  node: ToolNodeOf<"mcp">,
  deps: ResolvedDeps,
): Promise<ToolSet> {
  const { allowedTools } = node.tool;
  if (allowedTools.length === 0) return { tools: [], close: () => Promise.resolve() };

  const connection = await createTransport(node.tool, deps.secrets, deps.network);
  const client = new Client(CLIENT_INFO);
  const close = () => connection.shutdown();

  try {
    await client.connect(connection.transport);
    const available = await listAllTools(client);
    const missing = allowedTools.filter((name) => !available.some((tool) => tool.name === name));
    if (missing.length > 0) {
      throw new ToolSetupError(
        "INVALID_CONFIG",
        `O servidor MCP não oferece: ${missing.join(", ")}.`,
      );
    }
    const allowed = new Set(allowedTools);
    const tools = available.filter((tool) => allowed.has(tool.name));
    return { tools: tools.map((tool) => remoteTool(client, tool)), close };
  } catch (cause) {
    await close();
    if (cause instanceof ToolSetupError) throw cause;
    const stderr = connection.stderrTail();
    throw new ToolSetupError(
      "CONNECTION_FAILED",
      `Não foi possível conectar ao servidor MCP${stderr ? `: ${stderr}` : "."}`,
      { cause },
    );
  }
}
