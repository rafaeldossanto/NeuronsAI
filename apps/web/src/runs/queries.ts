import { useQuery } from "@tanstack/react-query";
import { unwrap, useApi } from "@/shared/api";

const LIVE_STATUSES = new Set(["pending", "running"]);

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
