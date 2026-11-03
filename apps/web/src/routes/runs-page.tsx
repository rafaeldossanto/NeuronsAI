import { Link } from "react-router";
import { RunStatusBadge } from "@/components/run-status-badge";
import { EmptyState, ErrorState, LoadingRows } from "@/components/states";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { useRuns } from "@/lib/queries";

export function RunsPage() {
  const runs = useRuns();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Execuções</h1>
        <p className="mt-1 text-muted-foreground">
          As rodadas de cada grafo, da mais recente à mais antiga.
        </p>
      </div>

      {runs.isPending && <LoadingRows label="Carregando execuções" />}
      {runs.isError && <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />}
      {runs.isSuccess && runs.data.length === 0 && (
        <EmptyState
          title="Nenhuma execução ainda"
          hint="Elas aparecem aqui quando um grafo for executado."
        />
      )}
      {runs.isSuccess && runs.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {runs.data.map((run) => (
            <li key={run.id}>
              <Card className="flex items-center justify-between gap-4 p-4 transition-colors hover:border-accent">
                <div className="min-w-0">
                  <Link
                    to={`/runs/${run.id}`}
                    className="block truncate font-mono text-sm font-bold hover:underline"
                  >
                    {run.id}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    Início {formatDateTime(run.startedAt)} · fim {formatDateTime(run.finishedAt)}
                  </p>
                </div>
                <RunStatusBadge status={run.status} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
