import type { GraphIssue } from "@neurons/graph-schema";
import {
  DomainError,
  type DomainErrorDetail,
  type DomainErrorKind,
} from "../shared/errors/domain-error.js";

export class GraphNotFoundError extends DomainError {
  readonly kind: DomainErrorKind = "not_found";

  constructor(graphId: string) {
    super("graph_not_found", `Grafo "${graphId}" não encontrado.`);
  }
}

export class GraphVersionNumberNotFoundError extends DomainError {
  readonly kind: DomainErrorKind = "not_found";

  constructor(graphId: string, version: number) {
    super("graph_version_not_found", `O grafo "${graphId}" não tem a versão ${version}.`);
  }
}

/** A run that has not finished still reads the graph's versions, so the graph stays until it ends. */
export class GraphHasActiveRunsError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor() {
    super("graph_has_active_runs", "Pare as execuções em andamento antes de excluir o projeto.");
  }
}

/** Pedidos de exclusão são entre pessoas de uma organização: sem contas, ninguém pede a ninguém. */
export class DeletionRequestsUnavailableError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor() {
    super(
      "deletion_requests_unavailable",
      "Pedidos de exclusão só existem com contas; aqui você exclui o projeto direto.",
    );
  }
}

/** Owners and admins already may delete: they do it, they do not ask. */
export class DeletionRequestNotNeededError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor() {
    super(
      "deletion_request_not_needed",
      "Você pode excluir este projeto direto, sem pedir aprovação.",
    );
  }
}

export class DeletionRequestAlreadyPendingError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor() {
    super("deletion_request_pending", "Este projeto já tem um pedido de exclusão pendente.");
  }
}

export class DeletionRequestNotFoundError extends DomainError {
  readonly kind: DomainErrorKind = "not_found";

  constructor() {
    super("deletion_request_not_found", "Este projeto não tem pedido de exclusão pendente.");
  }
}

/** Only who asked may withdraw the request; anyone else with the power to delete rejects it. */
export class DeletionRequestNotYoursError extends DomainError {
  readonly kind: DomainErrorKind = "forbidden";

  constructor() {
    super("deletion_request_not_yours", "Só quem pediu a exclusão pode cancelar o pedido.");
  }
}

/**
 * `{{secret:NAME}}` makes the server send a stored value to wherever the tool points, so on a
 * shared server only owners and admins may publish a version that uses one.
 */
export class SecretPublishForbiddenError extends DomainError {
  readonly kind: DomainErrorKind = "forbidden";

  constructor() {
    super(
      "secret_publish_forbidden",
      "Só administradores e proprietários podem publicar um grafo que usa credenciais. Versões antigas devem ser republicadas para aprovação.",
    );
  }
}

/** The definition does not pass `validateGraph`: `details` says what to fix. */
export class InvalidGraphError extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly details: readonly DomainErrorDetail[];

  constructor(issues: readonly GraphIssue[]) {
    super("invalid_graph", "O grafo tem problemas e não pode ser publicado.");
    this.details = issues.map((issue) => ({
      ...(issue.path && { path: issue.path.join(".") }),
      code: issue.code,
      message: issue.message,
      ...(issue.nodeId && { nodeId: issue.nodeId }),
      ...(issue.linkId && { linkId: issue.linkId }),
    }));
  }
}
