import { DomainError, type DomainErrorKind } from "../shared/errors/domain-error.js";

export class MasterKeyNotConfiguredError extends DomainError {
  readonly kind: DomainErrorKind = "unavailable";

  constructor() {
    super(
      "master_key_not_configured",
      "Chave mestra não configurada. Defina NEURONS_MASTER_KEY (32 bytes em base64).",
    );
  }
}

export class SecretNotFoundError extends DomainError {
  readonly kind: DomainErrorKind = "not_found";

  constructor(name: string) {
    super("secret_not_found", `Segredo "${name}" não encontrado.`);
  }
}

export class InvalidSecretNameError extends DomainError {
  readonly kind: DomainErrorKind = "invalid";

  constructor() {
    super(
      "invalid_secret_name",
      "Nome de segredo inválido: use de 1 a 128 caracteres entre letras, números, '.', '_' e '-'.",
    );
  }
}

/** Names the server uses for its own secrets (webhook signing keys) are not for people to write. */
export class ReservedSecretNameError extends DomainError {
  readonly kind: DomainErrorKind = "invalid";

  constructor() {
    super(
      "reserved_secret_name",
      'Nomes que começam com "webhook." são reservados ao servidor; escolha outro nome.',
    );
  }
}

/** Wrong master key or tampered data; deliberately says nothing about the plaintext. */
export class SecretDecryptionError extends DomainError {
  readonly kind: DomainErrorKind = "internal";

  constructor(name: string) {
    super(
      "secret_decryption_failed",
      `Não foi possível decifrar o segredo "${name}". A chave mestra mudou ou os dados foram alterados.`,
    );
  }
}
