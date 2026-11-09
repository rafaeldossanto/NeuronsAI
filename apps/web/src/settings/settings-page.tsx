import { useEffect, useState, type FormEvent } from "react";
import {
  DEFAULT_TRIGGERS_PORT,
  MAX_TRIGGERS_PORT,
  MIN_TRIGGERS_PORT,
  TUNNEL_DOCS_URL,
  desktopSettings,
  type DesktopSettingsBridge,
  type DesktopTriggersView,
} from "@/settings/desktop-settings";
import { EmptyState, ErrorState, LoadingRows } from "@/shared/states";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export function SettingsPage() {
  const bridge = desktopSettings();
  if (!bridge) {
    return (
      <EmptyState
        title="Estas configurações são do aplicativo para computador"
        hint="Abra o NeuronsAI instalado no seu computador para mudar a porta dos gatilhos externos."
      />
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="heading-4">Configurações</h1>
        <p className="text-sm text-muted-foreground">Ajustes do aplicativo neste computador.</p>
      </header>
      <TriggersSection bridge={bridge} />
    </div>
  );
}

function message(failure: unknown, fallback: string): string {
  return failure instanceof Error && failure.message ? failure.message : fallback;
}

function TriggersSection({ bridge }: { bridge: DesktopSettingsBridge }) {
  const [view, setView] = useState<DesktopTriggersView | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [port, setPort] = useState(String(DEFAULT_TRIGGERS_PORT));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function show(next: DesktopTriggersView) {
    setView(next);
    setEnabled(next.enabled);
    setPort(String(next.port));
  }

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    bridge.getTriggers().then(
      (next) => {
        if (!active) return;
        setLoadError(null);
        setView(next);
        setEnabled(next.enabled);
        setPort(String(next.port));
      },
      (failure: unknown) => {
        if (active)
          setLoadError(new Error(message(failure, "Não foi possível ler as configurações.")));
      },
    );
    return () => {
      active = false;
    };
  }, [bridge, attempt]);

  if (loadError) return <ErrorState error={loadError} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!view) return <LoadingRows rows={2} label="Carregando as configurações…" />;

  const number = Number(port);
  const portValid =
    port.trim() !== "" &&
    Number.isInteger(number) &&
    number >= MIN_TRIGGERS_PORT &&
    number <= MAX_TRIGGERS_PORT;
  const changed = enabled !== view.enabled || (portValid && number !== view.port);
  const locked = view.environment;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!portValid) return;
    setBusy(true);
    setError("");
    try {
      show(await bridge.setTriggers({ enabled, port: number }));
    } catch (failure) {
      setError(message(failure, "Não foi possível salvar. Tente de novo."));
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    setBusy(true);
    setError("");
    try {
      await bridge.restart();
    } catch (failure) {
      setError(message(failure, "Não foi possível reiniciar. Feche e abra o aplicativo."));
    } finally {
      setBusy(false);
    }
  }

  const futureAddress = `http://127.0.0.1:${portValid ? String(number) : port}`;

  return (
    <section aria-labelledby="triggers-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="triggers-title" className="text-lg font-bold">
          Gatilhos externos
        </h2>
        <p className="text-sm text-muted-foreground">
          Deixe o NeuronsAI receber chamadas de fora (um webhook) para iniciar execuções, por
          exemplo através de um túnel da Cloudflare. Fica desligado até você ligar, escuta só neste
          computador e só funciona com o aplicativo aberto.
        </p>
      </div>

      <form onSubmit={(event) => void save(event)} className="flex max-w-xl flex-col gap-4">
        <label className="flex items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            className="size-4"
            checked={enabled}
            disabled={locked || busy}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Receber chamadas externas (webhooks)
        </label>

        <div className="flex flex-col gap-1">
          <label htmlFor="triggers-port" className="text-sm font-semibold">
            Porta
          </label>
          <Input
            id="triggers-port"
            type="number"
            inputMode="numeric"
            min={MIN_TRIGGERS_PORT}
            max={MAX_TRIGGERS_PORT}
            className="max-w-40"
            value={port}
            disabled={locked || busy}
            aria-invalid={!portValid}
            aria-describedby="triggers-port-hint"
            onChange={(event) => setPort(event.target.value)}
          />
          <p
            id="triggers-port-hint"
            className={`caption-4 ${portValid ? "text-muted-foreground" : "font-semibold text-destructive"}`}
          >
            {portValid
              ? `De ${String(MIN_TRIGGERS_PORT)} a ${String(MAX_TRIGGERS_PORT)}. O padrão é ${String(DEFAULT_TRIGGERS_PORT)}.`
              : `Use uma porta entre ${String(MIN_TRIGGERS_PORT)} e ${String(MAX_TRIGGERS_PORT)}.`}
          </p>
        </div>

        <p className="text-sm" data-testid="triggers-address">
          {view.address ? (
            <>
              Endereço local agora: <code className="font-mono">{view.address}</code> (as chamadas
              vão em <code className="font-mono">/hooks/&lt;código&gt;</code>; o código de cada
              gatilho aparece no editor do projeto).
            </>
          ) : enabled && !locked ? (
            <>
              Depois de reiniciar o endereço local será{" "}
              <code className="font-mono">{futureAddress}</code>.
            </>
          ) : (
            "Desligado: nada escuta neste computador."
          )}
        </p>

        {locked && (
          <p className="rounded-md border p-3 text-sm" role="note">
            A porta está definida pela variável de ambiente{" "}
            <code className="font-mono">NEURONS_HOOKS_PORT</code>, que vale mais do que esta tela.
            Para mudar, altere a variável e reinicie o aplicativo.
          </p>
        )}

        {view.problem && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
          >
            {view.problem}
          </p>
        )}

        {view.restartRequired && (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-md border bg-muted/50 p-3 text-sm"
          >
            <p>
              <strong>Reinicie para aplicar.</strong> Ligar, desligar ou mudar a porta pede
              reiniciar o servidor embutido do aplicativo. O que estiver rodando é interrompido (o
              aplicativo avisa antes se houver execuções em andamento).
            </p>
            <div>
              <Button type="button" size="sm" disabled={busy} onClick={() => void restart()}>
                Reiniciar o NeuronsAI agora
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={locked || busy || !portValid || !changed}>
            Salvar
          </Button>
          <a
            href={TUNNEL_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold underline underline-offset-4"
          >
            Como publicar com o túnel da Cloudflare
          </a>
        </div>
      </form>
    </section>
  );
}
