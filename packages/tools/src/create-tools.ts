import type { ToolNode } from "@neurons/graph-schema";
import { ToolSetupError } from "./core/errors.js";
import { instrument } from "./core/instrument.js";
import { DEFAULT_LIMITS } from "./core/limits.js";
import type {
  ResolvedDeps,
  ToolDeps,
  ToolFactories,
  ToolFactory,
  ToolKind,
} from "./core/registry.js";
import type { ToolSet } from "./core/types.js";
import { createHttpTools } from "./http/http-tool.js";
import { createMcpTools } from "./mcp/mcp-tools.js";
import { createObsidianTools } from "./obsidian/obsidian-tools.js";

/** One factory per `kind` — supporting a new kind means adding an entry here. */
export const defaultToolFactories: ToolFactories = {
  mcp: createMcpTools,
  http: createHttpTools,
  obsidian: createObsidianTools,
};

export async function createTools(node: ToolNode, deps: ToolDeps): Promise<ToolSet> {
  const factories = { ...defaultToolFactories, ...deps.factories };
  // `kind` is guaranteed to select the factory typed for it; TS cannot correlate the two.
  const factory = factories[node.tool.kind] as ToolFactory<ToolKind> | undefined;
  if (!factory) {
    throw new ToolSetupError(
      "UNSUPPORTED_KIND",
      `Não há fábrica de ferramentas para o tipo "${node.tool.kind}".`,
    );
  }
  const resolved: ResolvedDeps = {
    secrets: deps.secrets,
    limits: { ...DEFAULT_LIMITS, ...deps.limits },
  };
  const toolSet = await factory(node, resolved);
  return {
    tools: toolSet.tools.map((tool) => instrument(tool, resolved.limits)),
    close: () => toolSet.close(),
  };
}
