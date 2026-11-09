import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, useApi } from "@/shared/api";

const triggerKey = (graphId: string, triggerId: string) => [
  "graphs",
  graphId,
  "triggers",
  triggerId,
];

/** Webhook and schedule state of one trigger block (on or off, route, last and next run). */
export function useTriggerState(graphId: string, triggerId: string) {
  const api = useApi();
  return useQuery({
    queryKey: triggerKey(graphId, triggerId),
    queryFn: () =>
      unwrap(
        api.GET("/graphs/{id}/triggers/{triggerId}", {
          params: { path: { id: graphId, triggerId } },
        }),
      ),
    refetchInterval: 15_000,
  });
}

/** Generates or replaces the webhook secret; the answer carries the secret, once. */
export function useRotateTriggerSecret(graphId: string, triggerId: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/graphs/{id}/triggers/{triggerId}/secret", {
          params: { path: { id: graphId, triggerId } },
        }),
      ),
    onSuccess: ({ state }) => client.setQueryData(triggerKey(graphId, triggerId), state),
  });
}

export function useSetTriggerEnabled(graphId: string, triggerId: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      unwrap(
        api.PUT("/graphs/{id}/triggers/{triggerId}/enabled", {
          params: { path: { id: graphId, triggerId } },
          body: { enabled },
        }),
      ),
    onSuccess: (state) => client.setQueryData(triggerKey(graphId, triggerId), state),
  });
}
