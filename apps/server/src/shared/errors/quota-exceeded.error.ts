import { DomainError } from "./domain-error.js";

/** A limit of the organization or account was reached (answered with 429). The message is pt-BR. */
export class QuotaExceededError extends DomainError {
  readonly kind = "quota_exceeded" as const;
  constructor(code: string, message: string) {
    super(code, message);
  }
}
