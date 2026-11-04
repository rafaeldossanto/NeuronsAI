import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { unwrap, useApi } from "@/lib/api";
import type { RunLogEvent } from "./types";

/** Server maximum for `limit`. */
export const EVENTS_PAGE_SIZE = 1000;

/**
 * Loads the whole log of a finished run from `GET /runs/{id}/events`, page by page (`fromSeq` =
 * last seq + 1) until a short page. `loaded` grows while it runs, for the progress line. A finished
 * run's log never changes, so it is fetched once.
 */
export function useRunEvents(runId: string, enabled: boolean) {
  const api = useApi();
  const [loaded, setLoaded] = useState(0);
  const query = useQuery({
    queryKey: ["runs", runId, "replay-events"],
    enabled,
    staleTime: Infinity,
    queryFn: async () => {
      const all: RunLogEvent[] = [];
      let fromSeq = 1;
      for (;;) {
        const { items } = await unwrap(
          api.GET("/runs/{id}/events", {
            params: { path: { id: runId }, query: { fromSeq, limit: EVENTS_PAGE_SIZE } },
          }),
        );
        for (const item of items)
          all.push({
            seq: item.seq,
            type: item.type,
            agent: item.agent,
            payload: item.payload,
            at: item.at,
          });
        setLoaded(all.length);
        const last = items.at(-1);
        if (!last || items.length < EVENTS_PAGE_SIZE) return all;
        fromSeq = last.seq + 1;
      }
    },
  });
  return { ...query, loaded };
}
