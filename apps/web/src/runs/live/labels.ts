import type { AgentLiveStatus, ConnectionState, LiveMessageKind } from "./types";

export const connectionLabel: Record<ConnectionState, string> = {
  connecting: "Conectando…",
  live: "Ao vivo",
  reconnecting: "Reconectando…",
  closed: "Encerrada",
};

export const agentStatusLabel: Record<AgentLiveStatus, string> = {
  starting: "Subindo",
  busy: "Ocupado",
  idle: "Ocioso",
  waiting_reply: "Esperando resposta",
  failed: "Falhou",
  finished: "Finalizado",
};

export const messageKindLabel: Record<LiveMessageKind, string> = {
  message: "mensagem",
  ask: "pergunta",
  reply: "resposta",
};
