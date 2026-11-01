import type { ToolConfig, ToolNode } from "@neurons/graph-schema";
import type { ToolLimits } from "./limits.js";
import type { SecretResolver } from "./secrets.js";
import type { ToolSet } from "./types.js";

export type ToolKind = ToolConfig["kind"];

export type ToolNodeOf<K extends ToolKind> = ToolNode & { tool: Extract<ToolConfig, { kind: K }> };

export interface ToolDeps {
  /** Used at setup time (e.g. secrets in MCP server env); calls use `ToolContext.secrets`. */
  secrets: SecretResolver;
  limits?: Partial<ToolLimits>;
  /** Replaces or extends the built-in factories; one entry per `kind`. */
  factories?: Partial<ToolFactories>;
}

export type ResolvedDeps = Omit<ToolDeps, "limits" | "factories"> & { limits: ToolLimits };

export type ToolFactory<K extends ToolKind> = (
  node: ToolNodeOf<K>,
  deps: ResolvedDeps,
) => Promise<ToolSet>;

export type ToolFactories = { [K in ToolKind]: ToolFactory<K> };
