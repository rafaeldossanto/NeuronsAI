import type { components } from "@neurons/api-client";
import { Link, useNavigate } from "react-router";
import { RunStatusBadge } from "@/runs/run-status-badge";
import { formatDateTime, formatDuration, formatUsd } from "@/shared/format";

export type RunListItem = components["schemas"]["RunListItem"];

/** Unknown cost is never shown as zero: a partial sum is a minimum, and a run with no known turn says so. */
export function RunCost({ run }: { run: RunListItem }) {
  if (run.turns === 0) return <span className="text-muted-foreground">—</span>;
  if (run.unknownCostTurns === run.turns) {
    return <span title="Nenhum turno informou o custo.">Desconhecido</span>;
  }
  if (run.unknownCostTurns === 0) return <span>{formatUsd(run.costUsd)}</span>;
  const turns = run.unknownCostTurns === 1 ? "1 turno" : `${run.unknownCostTurns} turnos`;
  return (
    <span title={`${turns} sem custo informado: o valor é um mínimo.`}>
      ≥ {formatUsd(run.costUsd)}
      <span className="block text-xs text-muted-foreground">+ {turns} sem custo</span>
    </span>
  );
}

const head =
  "px-3 py-2 sm:px-4 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";

const FINISHED = new Set(["succeeded", "failed", "cancelled"]);

export function RunsTable({ runs }: { runs: RunListItem[] }) {
  const navigate = useNavigate();
  return (
    <div
      className="relative overflow-x-auto rounded-lg border bg-card"
      role="region"
      aria-label="Lista de execuções"
      tabIndex={0}
    >
      <table className="w-full min-w-0 text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className={head}>Projeto</th>
            <th className={`${head} hidden sm:table-cell`}>Versão</th>
            <th className={head}>Status</th>
            <th className={`${head} hidden sm:table-cell`}>Início</th>
            <th className={`${head} hidden md:table-cell`}>Fim</th>
            <th className={`${head} hidden md:table-cell`}>Duração</th>
            <th className={head}>Custo</th>
            <th className={head}>
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run.id}
              className="cursor-pointer border-b last:border-b-0 hover:bg-muted/50"
              onClick={() => void navigate(`/runs/${run.id}`)}
            >
              <td className="px-3 py-3 sm:px-4">
                <Link
                  to={`/runs/${run.id}`}
                  className="font-bold hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {run.graphName}
                </Link>
                <span className="block font-mono text-xs text-muted-foreground">
                  {run.id.slice(0, 8)}
                </span>
                <span className="block text-xs text-muted-foreground sm:hidden">
                  {formatDateTime(run.startedAt)}
                </span>
              </td>
              <td className="hidden px-3 py-3 sm:table-cell sm:px-4">v{run.graphVersion}</td>
              <td className="px-3 py-3 sm:px-4">
                <RunStatusBadge status={run.status} />
              </td>
              <td className="hidden px-3 py-3 sm:table-cell sm:px-4">
                {formatDateTime(run.startedAt)}
              </td>
              <td className="hidden px-3 py-3 md:table-cell sm:px-4">
                {formatDateTime(run.finishedAt)}
              </td>
              <td className="hidden px-3 py-3 md:table-cell sm:px-4">
                {formatDuration(run.durationMs)}
              </td>
              <td className="px-3 py-3 sm:px-4">
                <RunCost run={run} />
              </td>
              <td className="px-3 py-3 sm:px-4 text-right">
                {FINISHED.has(run.status) && (
                  <Link
                    to={`/runs/${run.id}?replay=1`}
                    className="text-sm font-bold text-foreground underline-offset-2 hover:underline"
                    aria-label={`Replay da execução ${run.id.slice(0, 8)}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    Replay
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
