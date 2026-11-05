import { DomainError } from "../shared/errors/domain-error.js";

export class AccountNotFoundError extends DomainError {
  readonly kind = "not_found" as const;
  constructor() {
    super(
      "account_not_found",
      "Conta não encontrada. A pessoa precisa entrar no NeuronsAI primeiro.",
    );
  }
}

export class OrganizationAccessError extends DomainError {
  readonly kind = "forbidden" as const;
  constructor() {
    super("organization_access_denied", "Você não tem permissão para esta organização.");
  }
}

export class LastOwnerError extends DomainError {
  readonly kind = "conflict" as const;
  constructor() {
    super("organization_last_owner", "A organização precisa manter pelo menos um proprietário.");
  }
}

export class InvalidSessionError extends DomainError {
  readonly kind = "forbidden" as const;
  constructor() {
    super("invalid_session", "Sessão inválida ou expirada. Entre novamente.");
  }
}

/** A new identity tried to sign up on a server that only admits invited or listed people. */
export class SignupClosedError extends DomainError {
  readonly kind = "forbidden" as const;
  constructor() {
    super(
      "signup_closed",
      "Acesso só por convite. Peça a um administrador da sua organização para convidar o seu e-mail.",
    );
  }
}

export class InvitationNotFoundError extends DomainError {
  readonly kind = "not_found" as const;
  constructor() {
    super("invitation_not_found", "Convite não encontrado.");
  }
}
