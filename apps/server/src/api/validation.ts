import type { z } from "zod";
import {
  DomainError,
  type DomainErrorDetail,
  type DomainErrorKind,
} from "../shared/errors/domain-error.js";

/**
 * A request that does not match its contract. The details name the fields and say what is wrong;
 * they never repeat what was submitted, since a body may carry a secret.
 */
export class RequestValidationError extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly details: readonly DomainErrorDetail[];

  constructor(part: "params" | "query" | "body", error: z.ZodError) {
    super("validation_failed", "A requisição não está no formato esperado.");
    this.details = error.issues.map((issue) => ({
      path: [part, ...issue.path].join("."),
      code: issue.code,
      message: issue.message,
    }));
  }
}
