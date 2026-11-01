import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";

export class RunNotActiveError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor(runId: string) {
    super("run_not_active", `A execução "${runId}" não está em andamento.`);
  }
}

/** A policy of the chain refused the message. `code` and `reason` come from that policy. */
export class MessageDeniedError extends DomainError {
  readonly kind: DomainErrorKind = "forbidden";

  constructor(code: string, reason: string) {
    super(code, reason);
  }
}

export class InvalidMessageError extends DomainError {
  readonly kind: DomainErrorKind = "invalid";

  constructor(code: string, message: string) {
    super(code, message);
  }
}

export class MessageNotFoundError extends DomainError {
  readonly kind: DomainErrorKind = "not_found";

  constructor(messageId: string) {
    super("message_not_found", `Mensagem "${messageId}" não encontrada nesta execução.`);
  }
}

export class AskTimeoutError extends DomainError {
  readonly kind: DomainErrorKind = "unavailable";

  constructor(target: string, timeoutMs: number) {
    super(
      "ask_timeout",
      `"${target}" não respondeu à pergunta em ${Math.round(timeoutMs / 1000)} s.`,
    );
  }
}

/** The run ended while an `ask` was still waiting for its answer. */
export class RunEndedError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor(runId: string) {
    super("run_ended", `A execução "${runId}" terminou antes da resposta.`);
  }
}
