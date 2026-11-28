import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";

export class RunnerNameTakenError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor(name: string) {
    super("runner_name_taken", `Já existe um runner chamado "${name}".`);
  }
}

export class RunnerNotFoundError extends DomainError {
  readonly kind: DomainErrorKind = "not_found";

  constructor() {
    super("runner_not_found", "Runner não encontrado.");
  }
}

export class NoRunnerAvailableError extends DomainError {
  readonly kind: DomainErrorKind = "unavailable";

  constructor(waitedMs: number) {
    super(
      "no_runner_available",
      `Nenhum runner está conectado ao servidor${waitedMs > 0 ? ` (esperei ${Math.round(waitedMs / 1000)} s)` : ""}. Inicie um runner com o token emitido pelo servidor.`,
    );
  }
}

/** The agent is pinned to a personal runner of someone who did not start the run. */
export class RunnerNotAllowedError extends DomainError {
  readonly kind: DomainErrorKind = "forbidden";

  constructor() {
    super(
      "runner_not_allowed",
      "O runner escolhido para este agente é o computador pessoal de outro membro e não pode rodar uma execução que não foi iniciada por ele. Escolha um runner da organização ou o seu.",
    );
  }
}

export class RunnerLostError extends DomainError {
  readonly kind: DomainErrorKind = "unavailable";

  constructor(runnerName: string, reason: string) {
    super("runner_lost", `O runner "${runnerName}": ${reason}`);
  }
}
