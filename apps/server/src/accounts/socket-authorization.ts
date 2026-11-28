import type { IncomingMessage } from "node:http";
import { Inject, Injectable } from "@nestjs/common";
import { GraphAccessService } from "./graph-access.service.js";
import { resourceScope } from "./resource-scope.js";
import { AccountAuth } from "./account-auth.service.js";
import { requirePermission } from "./organization-access.js";
import { InvalidSessionError } from "./account.errors.js";
import { allowsLocalRequest } from "../shared/http/local-request-policy.js";

/** Each WebSocket operation revalidates session/membership; long-lived sockets cannot keep stale roles. */
@Injectable()
export class SocketAuthorization {
  get enabled(): boolean {
    return Boolean(this.auth.browser);
  }
  constructor(
    @Inject(AccountAuth) private readonly auth: AccountAuth,
    @Inject(GraphAccessService) private readonly graphAccess: GraphAccessService,
  ) {}

  async run<T>(
    request: IncomingMessage | undefined,
    runId: string,
    write: boolean,
    action: () => T,
  ): Promise<T> {
    if (!this.auth.browser) {
      if (!request || !allowsLocalRequest(request, this.auth.config))
        throw new InvalidSessionError();
      return action();
    }
    if (!request || request.headers.origin !== this.auth.config.auth?.publicOrigin)
      throw new InvalidSessionError();
    const scope = await this.auth.browser.authenticate(request);
    requirePermission(scope, write ? "write" : "read");
    const user = { organizationId: scope.organizationId, role: scope.role, userId: scope.userId };
    return resourceScope.run(user, async () => {
      // The run must be in the organization and the person must be allowed to see it (or, to type
      // in it, to act on it): someone who only uses a project sees just the runs they started.
      await this.graphAccess.requireRun(runId, write ? "write" : "read", user);
      return action();
    });
  }
}
