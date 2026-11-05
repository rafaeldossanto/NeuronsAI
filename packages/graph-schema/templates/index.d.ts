import type { GraphDefinition } from "../src/schemas/graph.js";

export type TemplateId = "sales-followup" | "research-review" | "api-cli-team";
export type TemplateCategory = "sales" | "research" | "development";
export interface GraphTemplate {
  id: TemplateId;
  name: string;
  description: string;
  category: TemplateCategory;
  requiredSecrets: string[];
  requiresApiKey: boolean;
  requiresWorkdir: boolean;
  /** Portable preview: terminal cwd is filled by instantiateTemplate, never a saved machine path. */
  graph: GraphDefinition;
}
export interface InstantiateTemplateOptions {
  projectId: string;
  name?: string;
  cwd?: string;
}
export function listTemplates(): GraphTemplate[];
export function getTemplate(id: string): GraphTemplate | undefined;
export function instantiateTemplate(
  id: string,
  options: InstantiateTemplateOptions,
): GraphDefinition;
