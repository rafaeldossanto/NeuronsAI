import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { expectNoContent, unwrap, useApi } from "@/shared/api";

export function useGraphs() {
  const api = useApi();
  return useQuery({
    queryKey: ["graphs"],
    queryFn: ({ signal }) => unwrap(api.GET("/graphs", { signal })).then((r) => r.items),
  });
}

export function useCreateGraph() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => unwrap(api.POST("/graphs", { body: { name } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ["graphs"], exact: true }),
  });
}

/** Deletes a project with its versions and run history; the server refuses (409) while a run is going. */
export function useDeleteGraph() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      expectNoContent(api.DELETE("/graphs/{id}", { params: { path: { id } } })),
    onSuccess: (_, id) => {
      client.removeQueries({ queryKey: ["graphs", id] });
      return client.invalidateQueries({ queryKey: ["graphs"], exact: true });
    },
  });
}

/** A member asks for the deletion; an owner or admin decides (approve deletes, reject keeps). */
export function useRequestGraphDeletion() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST("/graphs/{id}/deletion-request", { params: { path: { id } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ["graphs"], exact: true }),
  });
}

export function useCancelGraphDeletionRequest() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      expectNoContent(api.DELETE("/graphs/{id}/deletion-request", { params: { path: { id } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ["graphs"], exact: true }),
  });
}

export function useRejectGraphDeletionRequest() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      expectNoContent(
        api.POST("/graphs/{id}/deletion-request/reject", { params: { path: { id } } }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["graphs"], exact: true }),
  });
}

/** Approving deletes the project like `useDeleteGraph`; a run in progress refuses it (409). */
export function useApproveGraphDeletionRequest() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      expectNoContent(
        api.POST("/graphs/{id}/deletion-request/approve", { params: { path: { id } } }),
      ),
    onSuccess: (_, id) => {
      client.removeQueries({ queryKey: ["graphs", id] });
      return client.invalidateQueries({ queryKey: ["graphs"], exact: true });
    },
  });
}

export function useGraph(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["graphs", id],
    queryFn: ({ signal }) => unwrap(api.GET("/graphs/{id}", { params: { path: { id } }, signal })),
  });
}

export function useGraphVersions(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["graphs", id, "versions"],
    queryFn: ({ signal }) =>
      unwrap(api.GET("/graphs/{id}/versions", { params: { path: { id } }, signal })).then(
        (r) => r.items,
      ),
  });
}

export function useSaveDraft(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; draft: unknown }) =>
      unwrap(api.PATCH("/graphs/{id}", { params: { path: { id } }, body })),
    // Only the list and this graph: other graphs and the version lists are untouched by a draft save.
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["graphs"], exact: true }),
        client.invalidateQueries({ queryKey: ["graphs", id], exact: true }),
      ]),
  });
}

/** Freezes the saved draft as a new version (the request has no body: the server publishes the draft). */
export function usePublishVersion(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(api.POST("/graphs/{id}/versions", { params: { path: { id } }, body: {} })),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["graphs"], exact: true }),
        client.invalidateQueries({ queryKey: ["graphs", id], exact: true }),
        client.invalidateQueries({ queryKey: ["graphs", id, "versions"], exact: true }),
      ]),
  });
}
