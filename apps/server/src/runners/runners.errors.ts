import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";

export class RunnerNameTakenError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor(name: string) {
    super("runner_name_taken", `Já existe um runner chamado "${name}".`);
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

export class RunnerLostError extends DomainError {
  readonly kind: DomainErrorKind = "unavailable";

  constructor(runnerName: string, reason: string) {
    super("runner_lost", `O runner "${runnerName}": ${reason}`);
  }
}
