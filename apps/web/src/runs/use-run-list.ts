import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { unwrap, useApi } from "@/shared/api";
import type { toApiQuery } from "./run-filters";

const LIVE_STATUSES = new Set(["pending", "running"]);

/** One page of `GET /runs`; keeps showing the previous page while the next one loads, and refreshes while a listed run is live. */
export function useRunList(query: ReturnType<typeof toApiQuery>) {
  const api = useApi();
  return useQuery({
    queryKey: ["runs", "list", query],
    queryFn: ({ signal }) => unwrap(api.GET("/runs", { params: { query }, signal })),
    placeholderData: keepPreviousData,
    refetchInterval: (state) =>
      state.state.data?.items.some((run) => LIVE_STATUSES.has(run.status)) ? 3000 : false,
  });
}

/** The published versions of a graph, only once one is chosen (shares the cache of the editor's list). */
export function useVersionsOf(graphId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ["graphs", graphId, "versions"],
    queryFn: ({ signal }) =>
      unwrap(api.GET("/graphs/{id}/versions", { params: { path: { id: graphId! } }, signal })).then(
        (r) => r.items,
      ),
    enabled: graphId !== undefined,
  });
}
