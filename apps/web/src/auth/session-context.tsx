import { createContext, useContext } from "react";

export type OrganizationRole = "owner" | "admin" | "member" | "viewer";
export interface AccountSession {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
}
export interface SessionContextValue {
  account: AccountSession | null;
  reload: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
}
// App is also used directly by the local desktop shell and isolated editor tests.
export const SessionContext = createContext<SessionContextValue>({
  account: null,
  reload: async () => {},
  switchOrganization: async () => {},
});
export const useSession = () => useContext(SessionContext);
export const roleLabel: Record<OrganizationRole, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  member: "Membro",
  viewer: "Leitor",
};
export const canManage = (role: OrganizationRole) => role === "owner" || role === "admin";
