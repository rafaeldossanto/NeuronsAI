import type { GraphDefinition } from "./schemas/graph.js";
import type { Link } from "./schemas/link.js";
import type { AgentNode, ToolNode, TriggerNode } from "./schemas/node.js";

const position = { x: 0, y: 0 };

export function agent(id: string, name: string, overrides: Partial<AgentNode> = {}): AgentNode {
  return {
    id,
    type: "agent",
    position,
    name,
    role: `Papel de ${name}`,
    instructions: "Faça o seu trabalho.",
    effort: "medium",
    runtime: { kind: "api", provider: "anthropic", model: "claude-sonnet-5-5" },
    ...overrides,
  };
}

export function trigger(id: string, target: string): TriggerNode {
  return { id, type: "trigger", position, kind: "manual", target };
}

export function httpTool(id: string, name = "Consulta"): ToolNode {
  return {
    id,
    type: "tool",
    position,
    name,
    tool: { kind: "http", method: "GET", url: "https://api.exemplo.com.br", headers: {} },
  };
}

export function link(id: string, from: string, to: string, overrides: Partial<Link> = {}): Link {
  return { id, from, to, kind: "talk", bidirectional: false, ...overrides };
}

/** Valid graph: trigger -> Alfa, with Alfa allowed to start a talk with Beta. */
export function validGraph(overrides: Partial<GraphDefinition> = {}): GraphDefinition {
  return {
    schemaVersion: 1,
    id: "5b440250-ceba-42f4-8ce6-717a290384c4",
    name: "Grafo de teste",
    nodes: [trigger("t1", "a"), agent("a", "Alfa"), agent("b", "Beta")],
    links: [link("l1", "a", "b")],
    annotations: [],
    ...overrides,
  };
}
