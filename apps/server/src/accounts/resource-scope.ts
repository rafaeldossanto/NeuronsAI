import { AsyncLocalStorage } from "node:async_hooks";
import { eq, isNull, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { OrganizationRole } from "../database/schema/accounts.js";

export interface ResourceScope {
  organizationId: string | null;
  /** The caller's role in `organizationId`, set only for requests of a signed-in session. */
  role?: OrganizationRole;
}
const context = new AsyncLocalStorage<Readonly<ResourceScope>>();
const localScope: Readonly<ResourceScope> = Object.freeze({ organizationId: null });

/** Absent context is the existing local workspace. Only trusted auth/job code may enter a scope. */
export const resourceScope = {
  current(): Readonly<ResourceScope> {
    return context.getStore() ?? localScope;
  },
  run<T>(scope: ResourceScope, action: () => T): T {
    if (scope.organizationId !== null) z.uuid().parse(scope.organizationId);
    return context.run(
      Object.freeze({
        organizationId: scope.organizationId,
        ...(scope.role && { role: scope.role }),
      }),
      action,
    );
  },
  matches(column: PgColumn): SQL {
    const id = this.current().organizationId;
    return id === null ? isNull(column) : eq(column, id);
  },
  /** Capture before leaving a request: callbacks must not inherit the next caller's organization. */
  bind<TArgs extends unknown[], TResult>(
    action: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult {
    const scope = this.current();
    return (...args) => this.run(scope, () => action(...args));
  },
};
