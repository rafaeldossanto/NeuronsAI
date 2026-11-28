import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";

export class AgentChatBusyError extends DomainError {
  readonly kind = "conflict";

  constructor() {
    super("agent_chat_busy", "Este agente ainda está processando a mensagem anterior.");
  }
}

export class RunNotFoundError extends DomainError {
  readonly kind: DomainErrorKind = "not_found";

  constructor(runId: string) {
    super("run_not_found", `Execução "${runId}" não encontrada.`);
  }
}
