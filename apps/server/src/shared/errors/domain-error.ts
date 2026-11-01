/** Transport-agnostic category; the HTTP layer decides which status each kind becomes. */
export type DomainErrorKind = "not_found" | "invalid" | "conflict" | "unavailable" | "internal";

export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;

  /** @param code Stable machine-readable code (English). @param message Text for the user (pt-BR). */
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
