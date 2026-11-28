import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";

/** Pedidos de acesso são entre pessoas de uma organização: sem contas, todos já acessam tudo. */
export class GraphAccessUnavailableError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor() {
    super(
      "graph_access_unavailable",
      "O acesso por projeto só existe com contas; aqui você já acessa todos os projetos.",
    );
  }
}

/** The owner shut this person out: they cannot ask again until the owner lifts it. */
export class GraphAccessBlockedError extends DomainError {
  readonly kind: DomainErrorKind = "forbidden";

  constructor() {
    super(
      "graph_access_blocked",
      "O dono do projeto bloqueou o seu acesso, então não é possível pedir de novo.",
    );
  }
}

export class GraphAccessAlreadyGrantedError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor() {
    super("graph_access_already_granted", "Você já tem acesso a este projeto.");
  }
}

export class GraphAccessRequestPendingError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor() {
    super(
      "graph_access_request_pending",
      "Você já pediu acesso a este projeto e o pedido aguarda.",
    );
  }
}

export class GraphAccessRequestNotFoundError extends DomainError {
  readonly kind: DomainErrorKind = "not_found";

  constructor() {
    super(
      "graph_access_request_not_found",
      "Você não tem pedido de acesso pendente neste projeto.",
    );
  }
}

export class GraphAccessEntryNotFoundError extends DomainError {
  readonly kind: DomainErrorKind = "not_found";

  constructor() {
    super(
      "graph_access_entry_not_found",
      "Essa pessoa não tem liberação, bloqueio nem pedido neste projeto.",
    );
  }
}

export class GraphAccessMemberNotFoundError extends DomainError {
  readonly kind: DomainErrorKind = "not_found";

  constructor() {
    super("graph_access_member_not_found", "Essa pessoa não é membro da organização.");
  }
}

/** The project's owner and the organization's owners and admins always have full access. */
export class GraphAccessProtectedError extends DomainError {
  readonly kind: DomainErrorKind = "conflict";

  constructor() {
    super(
      "graph_access_protected",
      "O dono do projeto e os administradores da organização já têm acesso total e não podem ser limitados.",
    );
  }
}
