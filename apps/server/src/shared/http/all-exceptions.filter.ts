import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { DomainError, type DomainErrorKind } from "../errors/domain-error.js";
import type { ErrorBody } from "./error-body.js";

export type { ErrorBody } from "./error-body.js";

const STATUS_BY_KIND: Record<DomainErrorKind, HttpStatus> = {
  not_found: HttpStatus.NOT_FOUND,
  invalid: HttpStatus.BAD_REQUEST,
  forbidden: HttpStatus.FORBIDDEN,
  conflict: HttpStatus.CONFLICT,
  unavailable: HttpStatus.SERVICE_UNAVAILABLE,
  internal: HttpStatus.INTERNAL_SERVER_ERROR,
};

const CODE_BY_STATUS: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: "bad_request",
  [HttpStatus.NOT_FOUND]: "route_not_found",
  [HttpStatus.METHOD_NOT_ALLOWED]: "method_not_allowed",
  [HttpStatus.PAYLOAD_TOO_LARGE]: "payload_too_large",
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: "unsupported_media_type",
};

/**
 * Turns every error into `{ code, message, details? }`; unexpected errors never leak their details.
 * (What Fastify rejects before a handler runs, such as a body that is not JSON, arrives here as an
 * `HttpException` with Fastify's fixed message, which never quotes the body.)
 */
export function toHttpError(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof DomainError) {
    return {
      status: STATUS_BY_KIND[error.kind],
      body: {
        code: error.code,
        message: error.message,
        ...(error.details && { details: [...error.details] }),
      },
    };
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    return {
      status,
      body: { code: CODE_BY_STATUS[status] ?? `http_${status}`, message: error.message },
    };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { code: "internal_error", message: "Erro interno do servidor." },
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const { status, body } = toHttpError(error);
    // An unavailable dependency (no master key, no database) is expected: the response says it all.
    const expected = error instanceof DomainError && error.kind === "unavailable";
    if (status >= 500 && !expected) {
      this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
    void host.switchToHttp().getResponse<FastifyReply>().status(status).send(body);
  }
}
