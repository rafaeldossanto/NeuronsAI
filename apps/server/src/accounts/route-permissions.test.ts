import "reflect-metadata";
import { PATH_METADATA } from "@nestjs/common/constants.js";
import { expect, it, vi } from "vitest";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { OrganizationAccessError, RoutePermissionUndeclaredError } from "./account.errors.js";
import type { AccountAuth } from "./account-auth.service.js";
import { RequestScopeInterceptor } from "./request-scope.interceptor.js";
import { API_CONTROLLERS } from "../api/api-controllers.js";
import { contractOf } from "../api/endpoint.js";
import { AuthController } from "./auth.controller.js";
import { permissionOf } from "./require-permission.js";

/**
 * The permission a writing route needs inside an organization. A route declares it with
 * `@RequirePermission` (on the handler or the controller); one that declares nothing is refused by
 * `RequestScopeInterceptor`. Changing this table is a decision about who may do the thing: review
 * it, don't just update it.
 */
function writeRoutes(): string[] {
  return API_CONTROLLERS.filter((controller) => controller !== AuthController).flatMap(
    (controller) => {
      const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
      return Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
        const handler = (controller.prototype as Record<string, object>)[name]!;
        const contract = typeof handler === "function" ? contractOf(handler) : undefined;
        if (!contract || contract.method === "get") return [];
        const permission =
          permissionOf(handler) ?? permissionOf(controller as object) ?? "UNDECLARED";
        return [`${contract.method.toUpperCase()} /${prefix}/${contract.path} → ${permission}`];
      });
    },
  );
}

it("declares who may call every writing route; only credential routes ask for more than write", () => {
  expect(writeRoutes().sort()).toMatchInlineSnapshot(`
    [
      "DELETE /graphs/:id → write",
      "DELETE /runners/:name → manage_credentials",
      "PATCH /graphs/:id → write",
      "POST /connections/claude/login → manage_credentials",
      "POST /graphs/ → write",
      "POST /graphs/:id/triggers/:triggerId/secret → manage_credentials",
      "POST /graphs/:id/versions → write",
      "POST /memories/ → write",
      "POST /runners/ → manage_credentials",
      "POST /runs/ → write",
      "POST /runs/:id/messages → write",
      "POST /runs/:id/stop → write",
      "PUT /graphs/:id/triggers/:triggerId/enabled → write",
      "PUT /secrets/:name → manage_credentials",
    ]
  `);
});

it("leaves no writing route without a declaration", () => {
  expect(writeRoutes().filter((route) => route.endsWith("UNDECLARED"))).toEqual([]);
});

class FakeController {}
const declaredHandler = (): undefined => undefined;
const undeclaredHandler = (): undefined => undefined;
Reflect.defineMetadata("neurons:permission", "write", declaredHandler);

function interceptorFor(method: string, handler: () => undefined, role = "member") {
  const authenticate = vi.fn();
  const auth = {
    browser: {
      authenticate: authenticate.mockResolvedValue({ userId: "u1", organizationId: "o1", role }),
      requireMutation: vi.fn(),
    },
  } as unknown as AccountAuth;
  const interceptor = new RequestScopeInterceptor(auth);
  const header = vi.fn();
  const context = {
    getType: () => "http",
    getClass: () => FakeController,
    getHandler: () => handler,
    switchToHttp: () => ({ getResponse: () => ({ header }), getRequest: () => ({ method }) }),
  } as unknown as ExecutionContext;
  const handle = vi.fn();
  const next: CallHandler = { handle };
  return { interceptor, context, next, handle, authenticate };
}

it("refuses a writing request on a route that declares no permission, before any access check", async () => {
  const { interceptor, context, next, handle } = interceptorFor("POST", undeclaredHandler);
  await expect(interceptor.intercept(context, next)).rejects.toBeInstanceOf(
    RoutePermissionUndeclaredError,
  );
  expect(handle).not.toHaveBeenCalled();
});

it("checks the declared permission against the role read once by authenticate", async () => {
  const write = interceptorFor("POST", declaredHandler, "viewer");
  await expect(write.interceptor.intercept(write.context, write.next)).rejects.toBeInstanceOf(
    OrganizationAccessError,
  );
  expect(write.handle).not.toHaveBeenCalled();
  expect(write.authenticate).toHaveBeenCalledTimes(1);

  const allowed = interceptorFor("POST", declaredHandler, "member");
  await allowed.interceptor.intercept(allowed.context, allowed.next);

  const read = interceptorFor("GET", undeclaredHandler, "viewer");
  await read.interceptor.intercept(read.context, read.next);
});
