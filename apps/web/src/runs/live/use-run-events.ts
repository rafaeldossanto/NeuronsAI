import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { unwrap, useApi } from "@/shared/api";
import type { RunLogEvent } from "./types";

/** The progress line while the log loads: "N de M (X%)", or "N carregados" before the total is known. */
export function describeEventsProgress(loaded: number, total: number | null): string {
  if (total === null || total <= 0) return `${loaded} carregados`;
  const percent = Math.min(100, Math.floor((loaded / total) * 100));
  return `${loaded} de ${total} (${percent}%)`;
}

/** Server maximum for `limit`. */
export const EVENTS_PAGE_SIZE = 1000;

/**
 * Loads the whole log of a finished run from `GET /runs/{id}/events`, page by page (`fromSeq` =
 * last seq + 1) until a short page. `loaded` grows while it runs, for the progress line. A finished
 * run's log never changes, so it is fetched once. `total` is how many events the run has in all
 * (from the first page; null until it arrives), so the progress can say "N de M".
 */
export function useRunEvents(runId: string, enabled: boolean) {
  const api = useApi();
  const [loaded, setLoaded] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ["runs", runId, "replay-events"],
    enabled,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const all: RunLogEvent[] = [];
      let fromSeq = 1;
      for (;;) {
        const { items, total: whole } = await unwrap(
          api.GET("/runs/{id}/events", {
            params: { path: { id: runId }, query: { fromSeq, limit: EVENTS_PAGE_SIZE } },
            signal,
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
        setTotal(whole);
        setLoaded(all.length);
        const last = items.at(-1);
        if (!last || items.length < EVENTS_PAGE_SIZE) return all;
        fromSeq = last.seq + 1;
      }
    },
  });
  return { ...query, loaded, total };
}
