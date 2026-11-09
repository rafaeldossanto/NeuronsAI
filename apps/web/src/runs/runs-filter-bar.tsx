import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { runStatusLabel } from "@/shared/format";
import { useGraphs } from "@/graphs/queries";
import {
  RUN_STATUS_VALUES,
  SORT_OPTIONS,
  hasActiveFilters,
  type RunFilters,
  type SortKey,
} from "./run-filters";
import { useVersionsOf } from "./use-run-list";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-sm disabled:opacity-50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-36 flex-1 flex-col gap-1 text-xs font-semibold text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

/** A cost box that applies on Enter or when it loses focus, so typing does not query on every key. */
function CostInput({
  label,
  value,
  onApply,
}: {
  label: string;
  value: string | undefined;
  onApply: (value: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const apply = () => {
    const text = draft.trim().replace(",", ".");
    if (text === (value ?? "")) return;
    if (text === "") onApply(undefined);
    else if (Number.isFinite(Number(text)) && Number(text) >= 0) onApply(text);
    else setDraft(value ?? "");
  };
  return (
    <Field label={label}>
      <Input
        inputMode="decimal"
        placeholder="0,00"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={apply}
        onKeyDown={(event) => {
          if (event.key === "Enter") apply();
        }}
      />
    </Field>
  );
}

export function RunsFilterBar({
  filters,
  onChange,
}: {
  filters: RunFilters;
  /** Receives only what changed; the page resets to the first one. */
  onChange: (patch: Partial<RunFilters>) => void;
}) {
  const graphs = useGraphs();
  const versions = useVersionsOf(filters.graphId);
  const versionOptions = filters.graphId ? (versions.data ?? []) : [];

  return (
    <form
      aria-label="Filtros das execuções"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => event.preventDefault()}
    >
      <Field label="Status">
        <select
          className={selectClass}
          value={filters.status ?? ""}
          onChange={(event) =>
            onChange({ status: (event.target.value || undefined) as RunFilters["status"] })
          }
        >
          <option value="">Todos</option>
          {RUN_STATUS_VALUES.map((status) => (
            <option key={status} value={status}>
              {runStatusLabel[status]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Grafo">
        <select
          className={selectClass}
          value={filters.graphId ?? ""}
          onChange={(event) =>
            onChange({ graphId: event.target.value || undefined, graphVersionId: undefined })
          }
        >
          <option value="">Todos</option>
          {(graphs.data ?? []).map((graph) => (
            <option key={graph.id} value={graph.id}>
              {graph.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Versão">
        <select
          className={selectClass}
          disabled={!filters.graphId}
          value={filters.graphVersionId ?? ""}
          onChange={(event) => onChange({ graphVersionId: event.target.value || undefined })}
        >
          <option value="">{filters.graphId ? "Todas" : "Escolha um grafo"}</option>
          {versionOptions.map((version) => (
            <option key={version.id} value={version.id}>
              v{version.version}
            </option>
          ))}
        </select>
      </Field>

      <CostInput
        key={`min-${filters.minCostUsd ?? ""}`}
        label="Custo mínimo (US$)"
        value={filters.minCostUsd}
        onApply={(minCostUsd) => onChange({ minCostUsd })}
      />
      <CostInput
        key={`max-${filters.maxCostUsd ?? ""}`}
        label="Custo máximo (US$)"
        value={filters.maxCostUsd}
        onApply={(maxCostUsd) => onChange({ maxCostUsd })}
      />

      <Field label="Início de">
        <Input
          type="date"
          value={filters.from ?? ""}
          max={filters.to}
          onChange={(event) => onChange({ from: event.target.value || undefined })}
        />
      </Field>
      <Field label="Início até">
        <Input
          type="date"
          value={filters.to ?? ""}
          min={filters.from}
          onChange={(event) => onChange({ to: event.target.value || undefined })}
        />
      </Field>

      <Field label="Ordenar por">
        <select
          className={selectClass}
          value={filters.sort}
          onChange={(event) => onChange({ sort: event.target.value as SortKey })}
        >
          {Object.entries(SORT_OPTIONS).map(([key, option]) => (
            <option key={key} value={key}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      {hasActiveFilters(filters) && (
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            onChange({
              status: undefined,
              graphId: undefined,
              graphVersionId: undefined,
              minCostUsd: undefined,
              maxCostUsd: undefined,
              from: undefined,
              to: undefined,
            })
          }
        >
          Limpar filtros
        </Button>
      )}
    </form>
  );
}
