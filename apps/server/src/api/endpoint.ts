import "reflect-metadata";
import {
  applyDecorators,
  createParamDecorator,
  Delete,
  type ExecutionContext,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  SetMetadata,
} from "@nestjs/common";
import type { z } from "zod";
import { RequestValidationError } from "./validation.js";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/**
 * Everything an endpoint promises, in zod: the single source of truth for validating the request,
 * checking the response and describing both in the OpenAPI document. Handlers never re-declare it.
 */
export interface EndpointContract {
  method: HttpMethod;
  /** Nest path relative to the controller's (`":id/versions"`); empty for the controller's own path. */
  path: string;
  summary: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** The body of a success. Whatever is not in it never leaves the server. */
  response?: z.ZodType;
  /** Status of a success; defaults to 200. */
  status?: number;
  /** Error statuses besides the 400 that a validated request may get; every one has the {@link errorBodySchema} body. */
  errors?: readonly number[];
}

const ENDPOINT_CONTRACT = "neurons:endpoint-contract";

const MAPPINGS: Record<HttpMethod, (path: string) => MethodDecorator> = {
  get: Get,
  post: Post,
  put: Put,
  patch: Patch,
  delete: Delete,
};

/** Routes the handler and attaches its contract (read by the validators, the response check and OpenAPI). */
export function Endpoint(contract: EndpointContract): MethodDecorator {
  return applyDecorators(
    MAPPINGS[contract.method](contract.path),
    HttpCode(contract.status ?? 200),
    SetMetadata(ENDPOINT_CONTRACT, contract),
  );
}

export function contractOf(handler: object): EndpointContract | undefined {
  return Reflect.getMetadata(ENDPOINT_CONTRACT, handler) as EndpointContract | undefined;
}

type RequestPart = "params" | "query" | "body";

/** The part of the request, parsed by the schema the handler's contract declares for it. */
const validated = (part: RequestPart) =>
  createParamDecorator((_data: unknown, context: ExecutionContext) => {
    const schema = contractOf(context.getHandler())?.[part];
    if (!schema) throw new Error(`O contrato do endpoint não declara ${part}.`);
    const request = context.switchToHttp().getRequest<Record<RequestPart, unknown>>();
    const parsed = schema.safeParse(request[part]);
    if (!parsed.success) throw new RequestValidationError(part, parsed.error);
    return parsed.data;
  });

export const ValidParams = validated("params");
export const ValidQuery = validated("query");
export const ValidBody = validated("body");
