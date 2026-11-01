import type { GraphDefinition } from "../schemas/graph.js";
import type { AgentNode } from "../schemas/node.js";
import { findAgentByName, isAgent } from "./agents.js";

export interface AgentRef {
  id: string;
  name: string;
  role: string;
}

export interface AgentPeers {
  /** Agents this agent may start a conversation with. */
  canMessage: AgentRef[];
  /** Agents that may start a conversation with this agent. */
  canBeMessagedBy: AgentRef[];
}

const toRef = ({ id, name, role }: AgentNode): AgentRef => ({ id, name, role });

/** Who `agentName` may initiate talks with, and who may initiate talks with it. Unknown name: no peers. */
export function peersOf(graph: GraphDefinition, agentName: string): AgentPeers {
  const peers: AgentPeers = { canMessage: [], canBeMessagedBy: [] };
  const agent = findAgentByName(graph, agentName);
  if (!agent) return peers;

  const agentsById = new Map(graph.nodes.filter(isAgent).map((node) => [node.id, node]));

  for (const link of graph.links) {
    if (link.kind !== "talk") continue;
    const outgoing = link.from === agent.id;
    const incoming = link.to === agent.id;
    if (!outgoing && !incoming) continue;

    const other = agentsById.get(outgoing ? link.to : link.from);
    if (!other) continue;
    if (outgoing || link.bidirectional) peers.canMessage.push(toRef(other));
    if (incoming || link.bidirectional) peers.canBeMessagedBy.push(toRef(other));
  }
  return peers;
}
