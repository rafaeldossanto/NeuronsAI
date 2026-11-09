import { SetMetadata } from "@nestjs/common";
import type { OrganizationPermission } from "./organization-access.js";
const KEY = "neurons:permission";
export const RequirePermission = (permission: OrganizationPermission) =>
  SetMetadata(KEY, permission);
export const permissionOf = (target: object): OrganizationPermission | undefined =>
  Reflect.getMetadata(KEY, target) as OrganizationPermission | undefined;
