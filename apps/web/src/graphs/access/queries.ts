import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/accounts/auth/session-context";
import { expectNoContent, unwrap, useApi } from "@/shared/api";

/** Everything that depends on who may open a project: its list, its details and its access. */
const graphsKey = ["graphs"] as const;

/** Who is in, who is out and who asked. Only who manages the project may read it (the others get 404). */
export function useGraphAccess(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["graphs", id, "access"],
    queryFn: ({ signal }) =>
      unwrap(api.GET("/graphs/{id}/access", { params: { path: { id } }, signal })),
  });
}

/** The members of the organization the person is signed in to (the same list the organization page shows). */
export function useOrganizationMembers() {
  const api = useApi();
  const { account } = useSession();
  const organizationId = account?.organizationId ?? "";
  return useQuery({
    queryKey: ["members", organizationId],
    enabled: organizationId !== "",
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/auth/organizations/{id}/members", {
          params: { path: { id: organizationId } },
          signal,
        }),
      ),
  });
}

export function useSetGraphAccessMode(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (mode: "organization" | "restricted") =>
      unwrap(api.PUT("/graphs/{id}/access/mode", { params: { path: { id } }, body: { mode } })),
    onSuccess: () => client.invalidateQueries({ queryKey: graphsKey }),
  });
}

export type GraphAccessChange =
  | { userId: string; status: "granted"; level: "use" | "edit" }
  | { userId: string; status: "blocked" };

/** Lets a person in at a level (which also approves their request) or blocks them. */
export function useSetGraphAccess(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: GraphAccessChange) =>
      unwrap(
        api.PUT("/graphs/{id}/access/{userId}", {
          params: { path: { id, userId: change.userId } },
          body:
            change.status === "granted"
              ? { status: "granted", level: change.level }
              : { status: "blocked" },
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: graphsKey }),
  });
}

/** Takes back a release or a block, or refuses a request (the person may ask again unless blocked). */
export function useRemoveGraphAccess(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      expectNoContent(
        api.DELETE("/graphs/{id}/access/{userId}", { params: { path: { id, userId } } }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: graphsKey }),
  });
}

/** A person without access asks the owner to let them in. */
export function useRequestGraphAccess() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST("/graphs/{id}/access-request", { params: { path: { id } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: graphsKey, exact: true }),
  });
}

export function useCancelGraphAccessRequest() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      expectNoContent(api.DELETE("/graphs/{id}/access-request", { params: { path: { id } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: graphsKey, exact: true }),
  });
}

/** One published version with its frozen definition: what a person who only uses a project sees. */
export function useGraphVersion(id: string, version: number | null) {
  const api = useApi();
  return useQuery({
    queryKey: ["graphs", id, "version", version],
    enabled: version !== null,
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/graphs/{id}/versions/{version}", {
          params: { path: { id, version: version ?? 0 } },
          signal,
        }),
      ),
  });
}
