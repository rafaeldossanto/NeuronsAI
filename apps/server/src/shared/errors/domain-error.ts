/** Transport-agnostic category; the HTTP layer decides which status each kind becomes. */
export type DomainErrorKind =
  | "not_found"
  | "invalid"
  | "forbidden"
  | "conflict"
  | "quota_exceeded"
  | "unavailable"
  | "internal";

/** One thing wrong, for the errors that have several (a request body, a graph). */
export interface DomainErrorDetail {
  path?: string;
  code?: string;
  message: string;
  nodeId?: string;
  linkId?: string;
}

export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;
  /** What exactly is wrong, when there is more than the message. Never holds submitted values. */
  readonly details?: readonly DomainErrorDetail[];

  /** @param code Stable machine-readable code (English). @param message Text for the user (pt-BR). */
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
