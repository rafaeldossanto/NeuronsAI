import { Link, useParams } from "react-router";
import { RunStatusBadge } from "@/components/run-status-badge";
import { EmptyState, ErrorState, LoadingRows } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatTime, formatUsd } from "@/lib/format";
import { useRun, useRunEvents } from "@/lib/queries";

export function RunDetailPage() {
  const { id = "" } = useParams();
  const run = useRun(id);
  const live = run.data?.status === "running" || run.data?.status === "pending";
  const events = useRunEvents(id, live);

  if (run.isPending) return <LoadingRows label="Carregando execução" rows={4} />;
  if (run.isError) return <ErrorState error={run.error} onRetry={() => void run.refetch()} />;

  const { data } = run;
  const agents = Object.entries(data.usage.byAgent);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          to="/runs"
          className="text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          ← Execuções
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-bold">{data.id}</h1>
          <RunStatusBadge status={data.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Início {formatDateTime(data.startedAt)} · fim {formatDateTime(data.finishedAt)} ·{" "}
          <Link to={`/graphs/${data.graphId}`} className="underline">
            ver grafo
          </Link>
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Entrada</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{data.input}</p>
            {data.finish && (
              <p className="mt-3 text-sm text-muted-foreground">
                Terminou por <strong className="text-foreground">{data.finish.reason}</strong>
                {data.finish.message ? `: ${data.finish.message}` : ""}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Consumo</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              Total <strong>{formatUsd(data.usage.total.costUsd)}</strong> em{" "}
              {data.usage.total.turns} turnos
            </p>
            {agents.length > 0 && (
              <ul className="mt-2 text-sm text-muted-foreground">
                {agents.map(([name, usage]) => (
                  <li key={name}>
                    @{name}: {formatUsd(usage.costUsd)} · {usage.turns} turnos
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <section aria-label="Eventos">
        <h2 className="mb-3 text-lg font-bold">Eventos</h2>
        {events.isPending && <LoadingRows rows={3} label="Carregando eventos" />}
        {events.isError && (
          <ErrorState error={events.error} onRetry={() => void events.refetch()} />
        )}
        {events.isSuccess && events.data.length === 0 && <EmptyState title="Sem eventos ainda" />}
        {events.isSuccess && events.data.length > 0 && (
          <ol className="flex flex-col gap-2">
            {events.data.map((event) => (
              <li key={event.seq} className="rounded-md border bg-card px-4 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3">
                  <span className="font-mono text-xs text-muted-foreground">#{event.seq}</span>
                  <span className="font-bold">{event.type}</span>
                  {event.agent && <span className="text-muted-foreground">@{event.agent}</span>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatTime(event.at)}
                  </span>
                </div>
                {event.payload != null && (
                  <pre className="mt-1 overflow-x-auto text-xs text-muted-foreground">
                    {JSON.stringify(event.payload, null, 1)}
                  </pre>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
