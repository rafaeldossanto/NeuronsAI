import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";

/** Why a `terminal.input` or `terminal.resize` was refused. The messages never carry what was typed. */
export class TerminalInputRefusedError extends DomainError {
  constructor(
    code: TerminalInputRefusal,
    message: string,
    readonly kind: DomainErrorKind,
  ) {
    super(code, message);
  }
}

export type TerminalInputRefusal =
  | "run_not_running"
  | "agent_not_in_run"
  | "not_a_terminal"
  | "terminal_not_ready"
  | "terminal_unavailable"
  | "input_too_large"
  | "rate_limited"
  | "invalid_size"
  | "resize_rate_limited";

/** The agent has no terminal open yet (it starts on its first message) or it already closed. */
export class TerminalNotFoundError extends DomainError {
  readonly kind: DomainErrorKind = "not_found";

  constructor(agent: string) {
    super("terminal_not_ready", `O agente "${agent}" não tem um terminal aberto nesta execução.`);
  }
}

/** The terminal exists but cannot take input now (a runner that lost its connection). */
export class TerminalUnavailableError extends DomainError {
  readonly kind: DomainErrorKind = "unavailable";

  constructor(agent: string) {
    super(
      "terminal_unavailable",
      `O terminal do agente "${agent}" não está acessível agora; o que foi digitado não chegou.`,
    );
  }
}
