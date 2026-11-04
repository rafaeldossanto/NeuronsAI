import type { AgentNode, AgentPeers, AgentRef } from "@neurons/graph-schema";
import { HUMAN, TRIGGER } from "./addresses.js";

const formatPeers = (peers: AgentRef[]): string =>
  peers.length === 0
    ? "- (ninguém)"
    : peers.map((peer) => `- ${peer.name}${peer.role ? `: ${peer.role}` : ""}`).join("\n");

/**
 * The text an agent receives when it is started: who it is, what it was asked to do, who it can
 * talk to and how to use the communication tools. Pure, so it is easy to test and to evolve.
 */
export function buildBriefing(agent: AgentNode, peers: AgentPeers): string {
  return [
    `# Você é "${agent.name}"`,
    "",
    `Papel: ${agent.role}`,
    "",
    "## Instruções",
    "",
    agent.instructions,
    "",
    "## Seus pares",
    "",
    "Você pode iniciar conversa com:",
    formatPeers(peers.canMessage),
    "",
    "Podem iniciar conversa com você:",
    formatPeers(peers.canBeMessagedBy),
    "",
    "Quem lhe escrever sempre pode receber resposta sua com `reply`, mesmo sem uma seta de volta.",
    "",
    "## Ferramentas de comunicação",
    "",
    "- `send_message(to, text)`: envia uma mensagem e segue em frente, sem esperar resposta.",
    "- `ask(to, question)`: faz uma pergunta e espera a resposta (há um tempo limite). Use quando precisar da resposta para continuar.",
    "- `reply(messageId, text)`: responde a uma mensagem que você recebeu, usando o id que veio com ela. Responda sempre às perguntas (`ask`) que receber.",
    "- `list_peers()`: mostra com quem você pode conversar.",
    "- `list_tools()`: mostra as ferramentas e memórias ligadas a você no grafo, com parâmetros e permissões.",
    "- `use_tool(nodeId, name, input)`: usa uma dessas ferramentas. Consulte list_tools antes; a ligação define o acesso. Para editar uma nota, leia seu conteúdo atual primeiro.",
    "- `finish(result)`: encerra a execução inteira com o resultado final. Use somente quando o trabalho todo estiver concluído, não quando terminar a sua parte.",
    "",
    "## Regras",
    "",
    "- Só escreva a pares da lista acima; mensagens para outros destinos são recusadas.",
    `- As mensagens chegam uma por vez, com o remetente. \`${HUMAN}\` é uma pessoa e \`${TRIGGER}\` é o gatilho que iniciou a execução.`,
    "- Quando não tiver mais nada a fazer, apenas pare: uma nova mensagem volta a acordar você.",
  ].join("\n");
}
