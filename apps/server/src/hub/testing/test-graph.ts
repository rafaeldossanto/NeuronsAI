import type { AgentNode, GraphDefinition, Link } from "@neurons/graph-schema";

const position = { x: 0, y: 0 };

const agent = (name: string): AgentNode => ({
  id: `agente-${name.toLowerCase()}`,
  type: "agent",
  position,
  name,
  role: `Papel de ${name}`,
  instructions: `Instruções de ${name}.`,
  effort: "medium",
  runtime: { kind: "api", provider: "anthropic", model: "claude-sonnet-5-5" },
});

const talk = (from: string, to: string, bidirectional = false): Link => ({
  id: `${from}-${to}`,
  from: `agente-${from.toLowerCase()}`,
  to: `agente-${to.toLowerCase()}`,
  kind: "talk",
  bidirectional,
});

/**
 * trigger -> Alfa; Alfa -> Beta (one way); Beta <-> Gama; Delta is connected to nobody.
 * So Alfa may start talks with Beta only, Beta with Gama, Gama with Beta, and Delta with no one.
 */
export function buildTestGraph(): GraphDefinition {
  return {
    schemaVersion: 1,
    id: "5b440250-ceba-42f4-8ce6-717a290384c4",
    name: "Grafo de teste",
    nodes: [
      { id: "gatilho", type: "trigger", position, kind: "manual", target: "agente-alfa" },
      agent("Alfa"),
      agent("Beta"),
      agent("Gama"),
      agent("Delta"),
    ],
    links: [talk("Alfa", "Beta"), talk("Beta", "Gama", true)],
    annotations: [],
  };
}
