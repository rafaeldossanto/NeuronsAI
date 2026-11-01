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

export interface ErrorBody {
  code: string;
  message: string;
}

const STATUS_BY_KIND: Record<DomainErrorKind, HttpStatus> = {
  not_found: HttpStatus.NOT_FOUND,
  invalid: HttpStatus.BAD_REQUEST,
  conflict: HttpStatus.CONFLICT,
  unavailable: HttpStatus.SERVICE_UNAVAILABLE,
  internal: HttpStatus.INTERNAL_SERVER_ERROR,
};

const CODE_BY_STATUS: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: "bad_request",
  [HttpStatus.NOT_FOUND]: "route_not_found",
  [HttpStatus.METHOD_NOT_ALLOWED]: "method_not_allowed",
  [HttpStatus.PAYLOAD_TOO_LARGE]: "payload_too_large",
};

/** Turns every error into `{ code, message }`; unexpected errors never leak their details. */
export function toHttpError(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof DomainError) {
    return {
      status: STATUS_BY_KIND[error.kind],
      body: { code: error.code, message: error.message },
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
    if (status >= 500) {
      this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
    void host.switchToHttp().getResponse<FastifyReply>().status(status).send(body);
  }
}
