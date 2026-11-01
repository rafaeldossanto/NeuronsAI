import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";

export class GraphNotFoundError extends DomainError {
  readonly kind: DomainErrorKind = "not_found";

  constructor(graphId: string) {
    super("graph_not_found", `Grafo "${graphId}" não encontrado.`);
  }
}
