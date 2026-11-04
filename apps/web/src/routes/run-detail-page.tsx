import type { GraphNode } from "@neurons/graph-schema";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { GraphViewer } from "@/editor/graph-viewer";
import type { BlockLive } from "@/editor/nodes";
import { RunStatusBadge } from "@/components/run-status-badge";
import { ErrorState, LoadingRows } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime, formatUsd } from "@/lib/format";
import {
  agentStatusLabel,
  connectionLabel,
  selectActivity,
  useRunLive,
  type ConnectionState,
  type LivePulse,
  type RunLiveState,
} from "@/live";
import { ActivityList } from "@/live/activity-list";
import { AgentPanel } from "@/live/agent-panel";
import { pulsesByEdge, useActivePulses } from "@/live/pulse-edges";
import { useRunDetail, useRunGraph, useSendHumanMessage, useStopRun } from "@/live/run-queries";

/** Unknown cost is shown as unknown, never as $0. */
const costLabel = (usd: number | null) => (usd === null ? "custo desconhecido" : formatUsd(usd));

/** A message counts as "just happened" (worth a pulse) for this long after its timestamp. */
const FRESH_MS = 8_000;

export function RunDetailPage() {
  const { id = "" } = useParams();
  const detail = useRunDetail(id);
  const { state, connection, error, inputError, sendTerminalInput, clearInputError } =
    useRunLive(id);
  const graph = useRunGraph(detail.data?.graphId, detail.data?.graphVersionId);
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const doc = graph.data;
  const live = useMemo(
    () => liveByNode(doc?.nodes ?? [], state.agents),
    [doc?.nodes, state.agents],
  );
  const moving = useActivePulses(state.pulses, (pulse) => isRecent(state, pulse));
  const edgePulses = useMemo(() => (doc ? pulsesByEdge(doc, moving) : {}), [doc, moving]);

  // The final figures (and the dates) come from the server once, when the live state says it ended.
  const finishedSeq = state.finish?.seq;
  useEffect(() => {
    if (finishedSeq) void queryClient.invalidateQueries({ queryKey: ["runs", id] });
  }, [finishedSeq, id, queryClient]);

  if (detail.isPending) return <LoadingRows label="Carregando execução" rows={4} />;
  if (detail.isError)
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;

  const { data } = detail;
  const status = state.lastSeq > 0 ? state.status : data.status;
  const active = status === "pending" || status === "running";
  const finish = state.finish ?? data.finish;
  const agents = Object.values(state.agents);
  const timeline = selectActivity(state);
  const selectedNode = doc?.nodes.filter(isAgent).find((n) => n.id === selectedId);

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
          <RunStatusBadge status={status} />
          <ConnectionIndicator connection={connection} />
          {active && <StopButton runId={id} />}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Início {formatDateTime(data.startedAt)} · fim {formatDateTime(data.finishedAt)} ·{" "}
          <Link to={`/graphs/${data.graphId}`} className="underline">
            ver grafo
          </Link>
        </p>
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <section aria-label="Execução no desenho" className="flex flex-col gap-4">
        <div className="h-[420px] overflow-hidden rounded-lg border bg-background">
          {doc ? (
            <GraphViewer
              doc={doc}
              live={live}
              pulses={edgePulses}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">
              {graph.isError
                ? "Não foi possível carregar o desenho desta execução."
                : "Carregando o desenho…"}
            </p>
          )}
        </div>
        {selectedNode && (
          <AgentPanel
            key={selectedNode.id}
            name={selectedNode.name}
            node={selectedNode}
            state={state}
            runActive={active}
            inputError={inputError}
            onSendInput={sendTerminalInput}
            onClearInputError={clearInputError}
            onClose={() => setSelectedId(null)}
          />
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Entrada</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{data.input}</p>
            {finish && (
              <p className="mt-3 text-sm text-muted-foreground">
                Terminou por <strong className="text-foreground">{finish.reason}</strong>
                {finish.message ? `: ${finish.message}` : ""}
                {finish.result ? `: ${finish.result}` : ""}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Agentes e consumo</CardTitle>
          </CardHeader>
          <CardContent>
            <TotalsLine state={state} />
            {agents.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nenhum agente subiu ainda.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {agents.map((agent) => (
                  <li key={agent.name} className="flex flex-wrap items-baseline gap-x-2">
                    <strong>@{agent.name}</strong>
                    <span className="text-muted-foreground">
                      {agentStatusLabel[agent.status]} · {costLabel(agent.costUsd)}
                      {agent.costUsd !== null && agent.unknownCostTurns > 0 && " (ao menos)"} ·{" "}
                      {agent.turns} turnos
                    </span>
                    {agent.failure && (
                      <span className="text-destructive">falhou: {agent.failure}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {active && <SendMessageForm runId={id} agents={agents.map((a) => a.name)} />}

      {state.guardEvents.length > 0 && (
        <section aria-label="Guardas">
          <h2 className="mb-3 text-lg font-bold">Guardas</h2>
          <ul className="flex flex-col gap-2">
            {state.guardEvents.map((g) => (
              <li
                key={g.seq}
                className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm"
              >
                <strong>{g.type === "GuardTripped" ? "Parou" : "Aviso"}</strong> · {g.guard}
                {g.agent && ` · @${g.agent}`}: {g.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Linha do tempo">
        <h2 className="mb-3 text-lg font-bold">Linha do tempo</h2>
        <ActivityList items={timeline} empty="Nenhuma mensagem ainda" />
      </section>
    </div>
  );
}

function ConnectionIndicator({ connection }: { connection: ConnectionState }) {
  const live = connection === "live";
  return (
    <span
      role="status"
      aria-label="Conexão"
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
    >
      <span
        aria-hidden
        className={`size-2 rounded-full ${live ? "bg-accent" : "bg-muted-foreground/50"}`}
        style={live ? { animation: "pulse-amber 1.4s ease-in-out infinite" } : undefined}
      />
      {connectionLabel[connection]}
    </span>
  );
}

function TotalsLine({ state }: { state: RunLiveState }) {
  const { costUsd, turns, unknownCostTurns } = state.totals;
  return (
    <p className="text-sm">
      Total{" "}
      <strong>
        {unknownCostTurns > 0 && costUsd === 0 ? "custo desconhecido" : formatUsd(costUsd)}
      </strong>{" "}
      em {turns} turnos
      {unknownCostTurns > 0 && (
        <span className="text-muted-foreground">
          {" "}
          ({unknownCostTurns} sem custo informado: o valor é um mínimo)
        </span>
      )}
    </p>
  );
}

function StopButton({ runId }: { runId: string }) {
  const stop = useStopRun(runId);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={stop.isPending}
        onClick={() => stop.mutate()}
        className="ml-auto"
      >
        {stop.isPending ? "Parando…" : "Parar"}
      </Button>
      {stop.isError && (
        <span role="alert" className="text-sm text-destructive">
          {stop.error.message}
        </span>
      )}
    </>
  );
}

function SendMessageForm({ runId, agents }: { runId: string; agents: string[] }) {
  const send = useSendHumanMessage(runId);
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const listId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    const target = to.trim();
    if (!target || !body.trim()) return;
    send.mutate({ to: target, body }, { onSuccess: () => setBody("") });
  }

  return (
    <section aria-label="Mandar mensagem">
      <h2 className="mb-3 text-lg font-bold">Mandar mensagem como @human</h2>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Para o agente
          <Input
            list={listId}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Nome do agente"
            className="w-48"
          />
          <datalist id={listId}>
            {agents.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm font-semibold">
          Mensagem
          <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escreva…" />
        </label>
        <Button type="submit" disabled={send.isPending || !to.trim() || !body.trim()}>
          {send.isPending ? "Enviando…" : "Enviar"}
        </Button>
      </form>
      {send.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {send.error.message}
        </p>
      )}
    </section>
  );
}

const isAgent = (node: GraphNode): node is Extract<GraphNode, { type: "agent" }> =>
  node.type === "agent";

/** What each agent block shows, by node id; the agent is the one named like the block. */
function liveByNode(
  nodes: readonly GraphNode[],
  agents: RunLiveState["agents"],
): Record<string, BlockLive> {
  const result: Record<string, BlockLive> = {};
  for (const node of nodes.filter(isAgent)) {
    const agent = agents[node.name];
    if (agent)
      result[node.id] = {
        status: agent.status,
        costUsd: agent.costUsd,
        costIsMinimum: agent.unknownCostTurns > 0,
      };
  }
  return result;
}

/** True when the message behind the pulse was sent a moment ago (not part of the history). */
function isRecent(state: Pick<RunLiveState, "timeline">, pulse: LivePulse): boolean {
  const message = state.timeline.findLast((m) => m.seq === pulse.seq);
  const sentAt = message ? Date.parse(message.at) : NaN;
  return Number.isNaN(sentAt) || Date.now() - sentAt < FRESH_MS;
}
