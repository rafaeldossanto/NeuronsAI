/* global structuredClone */
import sales from "./sales-followup.json" with { type: "json" };
import research from "./research-review.json" with { type: "json" };
import team from "./api-cli-team.json" with { type: "json" };

const catalog = [sales, research, team];

/** Portable recipes keep cwd relative; instances receive the user's directory before validation. */
export function listTemplates() {
  return catalog.map((template) => ({
    ...structuredClone(template),
    requiresApiKey: template.graph.nodes.some(
      (node) => node.type === "agent" && node.runtime.kind === "api",
    ),
    requiresWorkdir: template.graph.nodes.some(
      (node) => node.type === "agent" && node.runtime.kind === "terminal",
    ),
  }));
}

export function getTemplate(id) {
  return listTemplates().find((template) => template.id === id);
}

export function instantiateTemplate(id, options) {
  const template = getTemplate(id);
  if (!template) throw new Error("Template não encontrado.");
  if (!options.projectId || catalog.some((entry) => entry.graph.id === options.projectId))
    throw new Error("O novo projeto precisa de um id próprio.");
  const cwd = options.cwd?.trim();
  if (template.requiresWorkdir && (!cwd || !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(cwd)))
    throw new Error("Informe a pasta de trabalho absoluta no computador do runner.");
  return {
    ...template.graph,
    id: options.projectId,
    name: options.name?.trim() || template.name,
    nodes: template.graph.nodes.map((node) =>
      node.type === "agent" && node.runtime.kind === "terminal"
        ? { ...node, runtime: { ...node.runtime, cwd } }
        : node,
    ),
  };
}
