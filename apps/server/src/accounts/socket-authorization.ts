import type { IncomingMessage } from "node:http";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { requireOwnedRun } from "./resource-ownership.js";
import { resourceScope } from "./resource-scope.js";
import { AccountAuth } from "./account-auth.service.js";
import { AccountsService } from "./accounts.service.js";
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
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
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
    await this.accounts.requireAccess(scope.userId, scope.organizationId, write ? "write" : "read");
    return resourceScope.run({ organizationId: scope.organizationId }, async () => {
      await requireOwnedRun(this.database.db, runId);
      return action();
    });
  }
}
