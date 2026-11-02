import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { map, type Observable } from "rxjs";
import { contractOf } from "./endpoint.js";

/**
 * Passes every success through the response schema of its endpoint. Besides catching a handler that
 * drifted from its contract (a 500 here, not a surprise in the client), parsing drops every field
 * the schema does not name, so a record's internals cannot reach the wire by accident.
 */
@Injectable()
export class ResponseContractInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = contractOf(context.getHandler())?.response;
    return schema ? next.handle().pipe(map((result) => schema.parse(result))) : next.handle();
  }
}
