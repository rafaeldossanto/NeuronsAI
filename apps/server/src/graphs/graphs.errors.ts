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

/** Versions are immutable and the runs point at them, so a graph that has any cannot be deleted. */
export class GraphHasVersionsError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor(graphId: string) {
    super(
      "graph_has_versions",
      `O grafo "${graphId}" já tem versões publicadas e não pode ser apagado.`,
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
