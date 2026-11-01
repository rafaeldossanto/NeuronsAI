import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";

export class GraphVersionNotFoundError extends DomainError {
  readonly kind: DomainErrorKind = "not_found";

  constructor(graphVersionId: string) {
    super("graph_version_not_found", `Versão de grafo "${graphVersionId}" não encontrada.`);
  }
}

/** The graph has no trigger to start from, or the caller must say which one. */
export class TriggerSelectionError extends DomainError {
  readonly kind: DomainErrorKind = "invalid";

  constructor(detail: string) {
    super("trigger_selection", detail);
  }
}

export class TriggerTargetNotFoundError extends DomainError {
  readonly kind: DomainErrorKind = "invalid";

  constructor(triggerId: string) {
    super(
      "trigger_target_not_found",
      `O gatilho "${triggerId}" não aponta para um agente do grafo.`,
    );
  }
}
