import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, useApi } from "@/shared/api";

export function useGraphs() {
  const api = useApi();
  return useQuery({
    queryKey: ["graphs"],
    queryFn: () => unwrap(api.GET("/graphs")).then((r) => r.items),
  });
}

export function useCreateGraph() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => unwrap(api.POST("/graphs", { body: { name } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ["graphs"] }),
  });
}

export function useGraph(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["graphs", id],
    queryFn: () => unwrap(api.GET("/graphs/{id}", { params: { path: { id } } })),
  });
}

export function useGraphVersions(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["graphs", id, "versions"],
    queryFn: () =>
      unwrap(api.GET("/graphs/{id}/versions", { params: { path: { id } } })).then((r) => r.items),
  });
}

export function useSaveDraft(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; draft: unknown }) =>
      unwrap(api.PATCH("/graphs/{id}", { params: { path: { id } }, body })),
    onSuccess: () => client.invalidateQueries({ queryKey: ["graphs"] }),
  });
}

/** Freezes the saved draft as a new version (the request has no body: the server publishes the draft). */
export function usePublishVersion(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(api.POST("/graphs/{id}/versions", { params: { path: { id } }, body: {} })),
    onSuccess: () => client.invalidateQueries({ queryKey: ["graphs"] }),
  });
}
