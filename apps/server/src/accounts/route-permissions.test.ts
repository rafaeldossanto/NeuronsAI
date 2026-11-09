import "reflect-metadata";
import { PATH_METADATA } from "@nestjs/common/constants.js";
import { expect, it } from "vitest";
import { API_CONTROLLERS } from "../api/api-controllers.js";
import { contractOf } from "../api/endpoint.js";
import { AuthController } from "./auth.controller.js";
import { permissionOf } from "./require-permission.js";

/**
 * The permission a writing route needs inside an organization. A route declares it with
 * `@RequirePermission`; one that declares nothing needs plain `write` (members and above). Changing
 * this table is a decision about who may do the thing: review it, don't just update it.
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
          permissionOf(handler) ?? permissionOf(controller as object) ?? "write (default)";
        return [`${contract.method.toUpperCase()} /${prefix}/${contract.path} → ${permission}`];
      });
    },
  );
}

it("declares who may call every writing route, and only credential routes ask for more than write", () => {
  expect(writeRoutes().sort()).toMatchInlineSnapshot(`
    [
      "DELETE /graphs/:id → write (default)",
      "DELETE /runners/:name → manage_credentials",
      "PATCH /graphs/:id → write (default)",
      "POST /connections/claude/login → manage_credentials",
      "POST /graphs/ → write (default)",
      "POST /graphs/:id/triggers/:triggerId/secret → manage_credentials",
      "POST /graphs/:id/versions → write (default)",
      "POST /memories/ → write (default)",
      "POST /runners/ → manage_credentials",
      "POST /runs/ → write (default)",
      "POST /runs/:id/messages → write (default)",
      "POST /runs/:id/stop → write (default)",
      "PUT /graphs/:id/triggers/:triggerId/enabled → write (default)",
      "PUT /secrets/:name → manage_credentials",
    ]
  `);
});
