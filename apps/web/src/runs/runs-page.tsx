import { Link, Navigate, useSearchParams } from "react-router";
import { EmptyState, ErrorState, LoadingRows } from "@/shared/states";
import { Button } from "@/shared/ui/button";
import {
  PAGE_SIZE,
  hasActiveFilters,
  parseFilters,
  toApiQuery,
  toSearchParams,
  type RunFilters,
} from "@/runs/run-filters";
import { RunsFilterBar } from "@/runs/runs-filter-bar";
import { RunsTable } from "@/runs/runs-table";
import { useRunList } from "@/runs/use-run-list";

export function RunsPage() {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const runs = useRunList(toApiQuery(filters));

  /** Changing a filter goes back to the first page; the address keeps the selection. */
  const change = (patch: Partial<RunFilters>) => {
    setParams(toSearchParams({ ...filters, ...patch, page: patch.page ?? 1 }));
  };

  const total = runs.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // The list shrank under the page the address asked for (or the address was edited): go to the last one.
  if (runs.isSuccess && !runs.isPlaceholderData && runs.data.items.length === 0 && total > 0) {
    return (
      <Navigate replace to={{ search: toSearchParams({ ...filters, page: pages }).toString() }} />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Execuções</h1>
        <p className="mt-1 text-muted-foreground">
          Cada vez que um projeto rodou. O custo soma só os turnos que informaram preço.
        </p>
      </div>

      <RunsFilterBar filters={filters} onChange={change} />

      {runs.isPending && <LoadingRows label="Carregando execuções" />}
      {runs.isError && <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />}
      {runs.isSuccess && total === 0 && !hasActiveFilters(filters) && (
        <EmptyState
          title="Nenhuma execução ainda"
          hint="Elas aparecem aqui quando um projeto for executado. Abra um projeto e use Executar."
          action={
            <Button asChild variant="outline">
              <Link to="/graphs">Ir para Meus projetos</Link>
            </Button>
          }
        />
      )}
      {runs.isSuccess && total === 0 && hasActiveFilters(filters) && (
        <EmptyState
          title="Nenhuma execução com esses filtros"
          hint="Ajuste ou limpe os filtros para ver outras."
        />
      )}
      {runs.isSuccess && runs.data.items.length > 0 && (
        <>
          <RunsTable runs={runs.data.items} />
          <nav aria-label="Paginação" className="flex items-center justify-between gap-4 text-sm">
            <p className="text-muted-foreground">
              {total === 1 ? "1 execução" : `${total} execuções`} · página {filters.page} de {pages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page <= 1}
                onClick={() => change({ page: filters.page - 1 })}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page >= pages}
                onClick={() => change({ page: filters.page + 1 })}
              >
                Próxima
              </Button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
