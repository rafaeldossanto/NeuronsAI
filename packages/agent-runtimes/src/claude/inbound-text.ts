import type { InboundMessage } from "../contract/agent-runtime.js";

/** What the model reads when a message arrives: who wrote, its id and what to do with it. */
export function formatInboundMessage(message: InboundMessage): string {
  const header = {
    message: `Mensagem de ${message.from} (id: ${message.id}):`,
    ask: `Pergunta de ${message.from} (id: ${message.id}). Responda com a ferramenta reply, usando esse id:`,
    reply: `Resposta de ${message.from} à sua mensagem ${message.replyTo ?? "anterior"} (id: ${message.id}):`,
  }[message.kind];
  return `${header}\n${message.body}`;
}
