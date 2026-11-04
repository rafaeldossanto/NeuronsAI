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

/**
 * The drawing of the graph version a run executes. A version is frozen, so it is fetched once: the
 * run only knows the version's id, so the list of versions says which number it is.
 */
export function useRunGraph(graphId: string | undefined, versionId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ["run-graph", graphId, versionId],
    enabled: Boolean(graphId && versionId),
    staleTime: Infinity,
    queryFn: async () => {
      const id = graphId ?? "";
      const { items } = await unwrap(
        api.GET("/graphs/{id}/versions", { params: { path: { id } } }),
      );
      const found = items.find((item) => item.id === versionId);
      if (!found) throw new Error("A versão do grafo desta execução não foi encontrada.");
      const version = await unwrap(
        api.GET("/graphs/{id}/versions/{version}", {
          params: { path: { id, version: found.version } },
        }),
      );
      return version.definition;
    },
  });
}
