/** The filters of the runs list as they live in the address: `?status=failed&graphId=…&page=2`. */

export const RUN_STATUS_VALUES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type RunStatusValue = (typeof RUN_STATUS_VALUES)[number];

export const SORT_OPTIONS = {
  recent: { label: "Mais recentes", sort: "startedAt", order: "desc" },
  oldest: { label: "Mais antigas", sort: "startedAt", order: "asc" },
  costly: { label: "Maior custo", sort: "costUsd", order: "desc" },
  cheap: { label: "Menor custo", sort: "costUsd", order: "asc" },
  longest: { label: "Mais demoradas", sort: "durationMs", order: "desc" },
  shortest: { label: "Mais rápidas", sort: "durationMs", order: "asc" },
} as const;
export type SortKey = keyof typeof SORT_OPTIONS;

export const PAGE_SIZE = 20;

export interface RunFilters {
  status?: RunStatusValue;
  graphId?: string;
  graphVersionId?: string;
  /** Known cost bounds, kept as typed (US$) until they go to the API. */
  minCostUsd?: string;
  maxCostUsd?: string;
  /** Local calendar days, `yyyy-mm-dd`. */
  from?: string;
  to?: string;
  sort: SortKey;
  /** 1-based. */
  page: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isCost = (value: string) =>
  value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
const isDay = (value: string) =>
  DAY.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());

/** Reads the address; anything that is not valid is ignored, so a hand-edited URL never breaks the page. */
export function parseFilters(params: URLSearchParams): RunFilters {
  const status = params.get("status");
  const graphId = params.get("graphId");
  const graphVersionId = params.get("graphVersionId");
  const minCostUsd = params.get("minCostUsd");
  const maxCostUsd = params.get("maxCostUsd");
  const from = params.get("from");
  const to = params.get("to");
  const sort = params.get("sort");
  const page = Number(params.get("page"));
  const validGraph = graphId !== null && UUID.test(graphId);
  return {
    ...(status !== null &&
      (RUN_STATUS_VALUES as readonly string[]).includes(status) && {
        status: status as RunStatusValue,
      }),
    ...(validGraph && { graphId }),
    // A version only makes sense inside its graph.
    ...(validGraph && graphVersionId !== null && UUID.test(graphVersionId) && { graphVersionId }),
    ...(minCostUsd !== null && isCost(minCostUsd) && { minCostUsd }),
    ...(maxCostUsd !== null && isCost(maxCostUsd) && { maxCostUsd }),
    ...(from !== null && isDay(from) && { from }),
    ...(to !== null && isDay(to) && { to }),
    sort: sort !== null && sort in SORT_OPTIONS ? (sort as SortKey) : "recent",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** The address for the filters; defaults are left out so the plain list has a plain URL. */
export function toSearchParams(filters: RunFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of [
    "status",
    "graphId",
    "graphVersionId",
    "minCostUsd",
    "maxCostUsd",
    "from",
    "to",
  ] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (filters.sort !== "recent") params.set("sort", filters.sort);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}

/** True when anything narrows the list (sort and page do not). */
export const hasActiveFilters = (filters: RunFilters) =>
  ["status", "graphId", "graphVersionId", "minCostUsd", "maxCostUsd", "from", "to"].some(
    (key) => filters[key as keyof RunFilters] !== undefined,
  );

/** The `GET /runs` query: the days become the start and the end of that day in the user's time zone. */
export function toApiQuery(filters: RunFilters) {
  const { sort, order } = SORT_OPTIONS[filters.sort];
  return {
    ...(filters.status && { status: filters.status }),
    ...(filters.graphId && { graphId: filters.graphId }),
    ...(filters.graphVersionId && { graphVersionId: filters.graphVersionId }),
    ...(filters.minCostUsd !== undefined && { minCostUsd: Number(filters.minCostUsd) }),
    ...(filters.maxCostUsd !== undefined && { maxCostUsd: Number(filters.maxCostUsd) }),
    ...(filters.from && { from: new Date(`${filters.from}T00:00:00`).toISOString() }),
    ...(filters.to && { to: new Date(`${filters.to}T23:59:59.999`).toISOString() }),
    sort,
    order,
    limit: PAGE_SIZE,
    offset: (filters.page - 1) * PAGE_SIZE,
  };
}
