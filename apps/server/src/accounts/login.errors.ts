import { DomainError } from "../shared/errors/domain-error.js";

export class IdentityVerificationError extends DomainError {
  readonly kind = "forbidden" as const;
  constructor() {
    super(
      "identity_verification_failed",
      "Não foi possível confirmar o login. Tente entrar novamente.",
    );
  }
}

export class LoginAttemptError extends DomainError {
  readonly kind = "forbidden" as const;
  constructor() {
    super("invalid_login_attempt", "O login expirou ou já foi utilizado. Inicie um novo login.");
  }
}
