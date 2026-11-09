import type { TriggerNode } from "@neurons/graph-schema";
import { checkCron, isValidTimezone } from "@neurons/graph-schema";
import { Check, Copy, KeyRound } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useInRouterContext } from "react-router";
import { Button } from "@/shared/ui/button";
import { formatDateTime } from "@/shared/format";
import { useRotateTriggerSecret, useSetTriggerEnabled, useTriggerState } from "@/triggers/queries";
import {
  OUTCOME_LABELS,
  curlExample,
  describeCron,
  formatMoment,
  localTimezone,
  upcomingRuns,
} from "./trigger-helpers";

/** What the cron field of a schedule shows underneath: why it is wrong, or what it means and when it fires. */
export function SchedulePreview({
  cron,
  timezone,
}: {
  cron: string;
  timezone: string | undefined;
}) {
  const preview = useMemo(() => {
    if (cron.trim() === "") return { kind: "empty" } as const;
    const check = checkCron(cron);
    if (!check.ok) return { kind: "invalid", message: check.message } as const;
    if (timezone && !isValidTimezone(timezone)) return { kind: "bad-zone" } as const;
    return {
      kind: "ok",
      description: describeCron(cron),
      runs: upcomingRuns(cron, timezone),
    } as const;
  }, [cron, timezone]);

  if (preview.kind === "empty") return null;
  if (preview.kind === "invalid") {
    return (
      <p role="alert" className="text-xs text-destructive">
        {preview.message}
      </p>
    );
  }
  if (preview.kind === "bad-zone") return null;
  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      {preview.description && (
        <p className="text-sm font-semibold text-foreground">{preview.description}</p>
      )}
      <p>Próximas execuções ({timezone ?? `fuso deste computador: ${localTimezone()}`}):</p>
      <ol aria-label="Próximas execuções" className="flex flex-col gap-0.5">
        {preview.runs.map((run) => (
          <li key={run.toISOString()}>{formatMoment(run, timezone)}</li>
        ))}
      </ol>
    </div>
  );
}

export function TimezoneHint({ timezone }: { timezone: string | undefined }) {
  if (timezone && !isValidTimezone(timezone)) {
    return (
      <p role="alert" className="text-xs text-destructive">
        Fuso horário desconhecido. Use um nome como America/Sao_Paulo ou UTC.
      </p>
    );
  }
  return null;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copiado" : "Copiar"}
    </Button>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {title}
      </span>
      {children}
    </div>
  );
}

function ErrorText({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {error.message}
    </p>
  );
}

/** The server's side of a webhook or schedule block: on or off, route and secret, last and next run. */
export function ExternalTriggerPanel({ graphId, node }: { graphId: string; node: TriggerNode }) {
  const state = useTriggerState(graphId, node.id);
  const setEnabled = useSetTriggerEnabled(graphId, node.id);

  if (state.isPending) return <p className="text-xs text-muted-foreground">Carregando o estado…</p>;
  if (state.isError) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {state.error.message}
      </p>
    );
  }
  const data = state.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{data.enabled ? "Ativo" : "Desativado"}</span>
        <Button
          type="button"
          variant={data.enabled ? "outline" : "accent"}
          size="sm"
          disabled={setEnabled.isPending}
          onClick={() => setEnabled.mutate(!data.enabled)}
        >
          {data.enabled ? "Desativar" : "Ativar"}
        </Button>
      </div>
      <ErrorText error={setEnabled.error} />
      <p className="text-xs text-muted-foreground">
        Roda a versão <b>publicada mais recente</b> do grafo. Publique o grafo para valer o que você
        mudou aqui.
      </p>

      {node.kind === "webhook" && <WebhookSection graphId={graphId} node={node} state={data} />}
      {node.kind === "schedule" && data.nextRunAt && (
        <Block title="Próxima execução">
          <span className="text-sm">{formatDateTime(data.nextRunAt)}</span>
        </Block>
      )}
      <LastRun state={data} />
    </div>
  );
}

type TriggerState = NonNullable<ReturnType<typeof useTriggerState>["data"]>;

function LastRun({ state }: { state: TriggerState }) {
  const inRouter = useInRouterContext();
  if (!state.lastRun) return null;
  const { at, outcome, note, runId } = state.lastRun;
  return (
    <Block title="Última vez">
      <p className="text-sm">
        {formatDateTime(at)} · {OUTCOME_LABELS[outcome]}
      </p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {runId &&
        (inRouter ? (
          <Link to={`/runs/${runId}`} className="text-xs font-semibold underline">
            Abrir a execução
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">Execução {runId}</span>
        ))}
    </Block>
  );
}

function WebhookSection({
  graphId,
  node,
  state,
}: {
  graphId: string;
  node: TriggerNode;
  state: TriggerState;
}) {
  const rotate = useRotateTriggerSecret(graphId, node.id);
  // Held only here: the server never shows it again, and leaving the block drops it.
  const [revealed, setRevealed] = useState<string | null>(null);

  const url =
    state.hookPath && state.hooksPort
      ? `http://127.0.0.1:${String(state.hooksPort)}${state.hookPath}`
      : null;

  const generate = () => {
    if (
      state.hasSecret &&
      !window.confirm("Trocar o segredo? O atual deixa de valer na hora para quem chama.")
    ) {
      return;
    }
    rotate.mutate(undefined, { onSuccess: (result) => setRevealed(result.secret) });
  };

  return (
    <div className="flex flex-col gap-4">
      {state.hooksPort === null && (
        <p role="note" className="rounded-md border border-input bg-muted p-2 text-xs">
          A porta dos gatilhos está desligada. Defina <code>NEURONS_HOOKS_PORT</code> para o
          servidor (ou o app) receber chamadas.
        </p>
      )}

      <Block title="URL">
        {url ? (
          <>
            <code aria-label="URL do webhook" className="break-all rounded-md bg-muted p-2 text-xs">
              {url}
            </code>
            <p className="text-xs text-muted-foreground">
              Com um túnel (Cloudflare Tunnel), troque só o endereço pelo do túnel: o caminho{" "}
              <code>{state.hookPath}</code> é o mesmo.
            </p>
            <div>
              <CopyButton text={url} label="Copiar a URL" />
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {state.hookPath
              ? "Sem a porta dos gatilhos não há URL para chamar."
              : "A URL aparece depois de gerar o segredo."}
          </p>
        )}
      </Block>

      <Block title="Segredo">
        <p className="text-xs text-muted-foreground">
          {state.hasSecret
            ? "Há um segredo guardado (cifrado). Ele não pode ser mostrado de novo."
            : "Ainda não há segredo: sem ele nenhuma chamada é aceita."}
        </p>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rotate.isPending}
            onClick={generate}
          >
            <KeyRound className="size-4" /> {state.hasSecret ? "Trocar segredo" : "Gerar segredo"}
          </Button>
        </div>
        <ErrorText error={rotate.error} />
        {revealed && (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-md border border-accent bg-accent/10 p-3"
          >
            <p className="text-xs font-bold">
              Copie agora: este segredo não será mostrado de novo. Se perder, gere outro.
            </p>
            <code aria-label="Segredo do webhook" className="break-all rounded bg-card p-2 text-xs">
              {revealed}
            </code>
            <div className="flex gap-2">
              <CopyButton text={revealed} label="Copiar o segredo" />
              <Button type="button" variant="ghost" size="sm" onClick={() => setRevealed(null)}>
                Já copiei
              </Button>
            </div>
          </div>
        )}
      </Block>

      {url && (
        <Block title="Exemplo de chamada assinada">
          <pre
            aria-label="Exemplo de curl"
            className="overflow-x-auto whitespace-pre rounded-md bg-muted p-2 text-[11px] leading-relaxed"
          >
            {curlExample(url)}
          </pre>
          <p className="text-xs text-muted-foreground">
            Guarde o segredo na variável <code>NEURONS_WEBHOOK_SECRET</code>. A assinatura é o
            HMAC-SHA256 de <code>timestamp.corpo</code>; vale por 5 minutos e só uma vez.
          </p>
          <div>
            <CopyButton text={curlExample(url)} label="Copiar o exemplo" />
          </div>
        </Block>
      )}
    </div>
  );
}
