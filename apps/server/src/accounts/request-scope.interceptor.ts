import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Observable } from "rxjs";
import { AccountAuth } from "./account-auth.service.js";
import { AccountsService } from "./accounts.service.js";
import { AuthController } from "./auth.controller.js";
import { resourceScope } from "./resource-scope.js";
import { HealthController } from "../health/health.controller.js";
import { OpenApiController } from "../api/openapi/openapi.controller.js";

@Injectable()
export class RequestScopeInterceptor implements NestInterceptor {
  constructor(
    @Inject(AccountAuth) private readonly auth: AccountAuth,
    @Inject(AccountsService) private readonly accounts: AccountsService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() === "http" && this.auth.browser)
      context.switchToHttp().getResponse<FastifyReply>().header("Cache-Control", "no-store");
    if (
      context.getType() !== "http" ||
      !this.auth.browser ||
      [AuthController, HealthController, OpenApiController].some(
        (controller) => controller === context.getClass(),
      )
    )
      return next.handle();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const scope = await this.auth.browser.authenticate(request);
    const writes = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (writes) this.auth.browser.requireMutation(request);
    const controllerPath = Reflect.getMetadata("path", context.getClass()) as string;
    const permission = writes
      ? ["secrets", "runners", "connections"].includes(controllerPath)
        ? "manage_credentials"
        : "write"
      : "read";
    await this.accounts.requireAccess(scope.userId, scope.organizationId, permission);
    return new Observable((subscriber) =>
      resourceScope.run({ organizationId: scope.organizationId }, () =>
        next.handle().subscribe(subscriber),
      ),
    );
  }
}
