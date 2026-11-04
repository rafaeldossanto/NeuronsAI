import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, useApi } from "./api";

const LIVE_STATUSES = new Set(["pending", "running"]);

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

export function useRun(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["runs", id],
    queryFn: () => unwrap(api.GET("/runs/{id}", { params: { path: { id } } })),
    refetchInterval: (query) =>
      query.state.data && LIVE_STATUSES.has(query.state.data.status) ? 2000 : false,
  });
}

export function useRunEvents(id: string, live: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ["runs", id, "events"],
    queryFn: () =>
      unwrap(
        api.GET("/runs/{id}/events", { params: { path: { id }, query: { limit: 500 } } }),
      ).then((r) => r.items),
    refetchInterval: live ? 2000 : false,
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
