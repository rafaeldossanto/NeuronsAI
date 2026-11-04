import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, useApi } from "@/lib/api";

/**
 * The run's static data (input, graph, dates). No polling: what changes comes over `/ws`; the
 * screen refetches this once, when the live state says the run finished, to get the final totals.
 */
export function useRunDetail(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["runs", id, "detail"],
    queryFn: () => unwrap(api.GET("/runs/{id}", { params: { path: { id } } })),
  });
}

export function useStopRun(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/runs/{id}/stop", { params: { path: { id } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ["runs", id] }),
  });
}

/** Sends a message as `@human` to an agent of the run. */
export function useSendHumanMessage(id: string) {
  const api = useApi();
  return useMutation({
    mutationFn: (input: { to: string; body: string }) =>
      unwrap(api.POST("/runs/{id}/messages", { params: { path: { id } }, body: input })),
  });
}
