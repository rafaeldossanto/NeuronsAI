import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { Network, Wrench } from "lucide-react";
import { RunStatusBadge } from "@/components/run-status-badge";
import { ErrorState, LoadingRows } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime, formatTime, formatUsd } from "@/lib/format";
import { useRunLive, type AgentLiveStatus, type ConnectionState, type RunLiveState } from "@/live";
import { useRunDetail, useSendHumanMessage, useStopRun } from "@/live/run-queries";

const connectionLabel: Record<ConnectionState, string> = {
  connecting: "Conectando…",
  live: "Ao vivo",
  reconnecting: "Reconectando…",
  closed: "Encerrada",
};

const agentStatusLabel: Record<AgentLiveStatus, string> = {
  starting: "Subindo",
  busy: "Ocupado",
  idle: "Ocioso",
  waiting_reply: "Esperando resposta",
  failed: "Falhou",
  finished: "Finalizado",
};

const kindLabel = { message: "mensagem", ask: "pergunta", reply: "resposta" } as const;

/** Unknown cost is shown as unknown, never as $0. */
const costLabel = (usd: number | null) => (usd === null ? "custo desconhecido" : formatUsd(usd));

export function RunDetailPage() {
  const { id = "" } = useParams();
  const detail = useRunDetail(id);
  const { state, connection, error } = useRunLive(id);
  const queryClient = useQueryClient();

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

      {state.toolCalls.length > 0 && (
        <section aria-label="Memórias e ferramentas">
          <h2 className="mb-3 text-lg font-bold">Memórias e ferramentas</h2>
          <ol className="flex flex-col gap-2">
            {state.toolCalls.map((call) => {
              const memory = call.tool.startsWith("obsidian_");
              const Icon = memory ? Network : Wrench;
              const labels: Record<string, string> = {
                obsidian_search: "Buscar notas",
                obsidian_read: "Ler nota",
                obsidian_links: "Seguir links",
                obsidian_create: "Criar nota",
                obsidian_edit: "Editar nota",
              };
              return (
                <li
                  key={call.seq}
                  className="flex items-start gap-3 rounded-md border bg-card px-4 py-3 text-sm"
                >
                  <Icon
                    aria-label={memory ? "Memória" : "Ferramenta"}
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-x-3">
                      <strong>{labels[call.tool] ?? call.tool}</strong>
                      {call.agent && <span>@{call.agent}</span>}
                      <span className={call.ok ? "text-muted-foreground" : "text-destructive"}>
                        {call.ok ? "Concluída" : "Falhou"}
                        {call.durationMs !== null && ` · ${call.durationMs} ms`}
                      </span>
                      <time className="ml-auto text-xs text-muted-foreground">
                        {formatTime(call.at)}
                      </time>
                    </div>
                    {call.path && (
                      <p className="mt-1 break-words text-muted-foreground">{call.path}</p>
                    )}
                    {call.errorCode && <p className="mt-1 text-destructive">{call.errorCode}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

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

      <section aria-label="Mensagens">
        <h2 className="mb-3 text-lg font-bold">Mensagens</h2>
        {state.timeline.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhuma mensagem ainda
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {state.timeline.map((m) => (
              <li key={m.seq} className="rounded-md border bg-card px-4 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3">
                  <span className="font-mono text-xs text-muted-foreground">#{m.seq}</span>
                  <span className="font-bold">
                    {m.from} → {m.to}
                  </span>
                  <span className="text-muted-foreground">{kindLabel[m.kind]}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{formatTime(m.at)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap">{m.preview}</p>
              </li>
            ))}
          </ol>
        )}
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
