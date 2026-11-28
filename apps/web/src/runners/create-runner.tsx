import { useState, type FormEvent } from "react";
import { CopyButton } from "@/accounts/account-ui";
import { Modal } from "@/shared/modal";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { apiBaseUrl } from "@/config";
import { unwrap, useApi } from "@/shared/api";

export type RunnerKind = "organization" | "personal";

const TEXT: Record<
  RunnerKind,
  { title: string; intro: string; label: string; submit: string; failure: string }
> = {
  organization: {
    title: "Cadastrar runner",
    intro: "Dê um nome ao computador. Você receberá um token para conectá-lo a este espaço.",
    label: "Nome do runner",
    submit: "Gerar token de conexão",
    failure: "Não foi possível cadastrar o runner.",
  },
  personal: {
    title: "Gerar token pessoal",
    intro:
      "Dê um nome ao seu computador. O token conecta um runner que roda só as execuções que você iniciar.",
    label: "Nome do computador",
    submit: "Gerar token",
    failure: "Não foi possível gerar o token.",
  },
};

/** Issues a runner's token, shown once, and tells how to start the runner by hand with it. */
export function CreateRunner({
  kind,
  onClose,
  onCreated,
}: {
  kind: RunnerKind;
  onClose: () => void;
  onCreated: () => void;
}) {
  const api = useApi();
  const text = TEXT[kind];
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Keep the one-time credential out of query caches, URLs and browser storage.
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const body = { name: name.trim() };
      const result =
        kind === "personal"
          ? await unwrap(api.POST("/runners/personal", { body }))
          : await unwrap(api.POST("/runners", { body }));
      setIssued({ name: result.name, token: result.token });
      onCreated();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : text.failure);
    } finally {
      setBusy(false);
    }
  }
  const serverUrl = new URL(apiBaseUrl).origin;
  return (
    <Modal
      title={issued ? "Conectar computador" : text.title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {issued ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h3 className="title-3 break-words">{issued.name}</h3>
            <p className="body-6">Guarde este token agora. Ele não será exibido novamente.</p>
          </div>
          <label className="title-4 flex flex-col gap-2">
            Token do runner
            <Input value={issued.token} readOnly autoComplete="off" spellCheck={false} />
          </label>
          <CopyButton value={issued.token} label="Copiar token" />
          <section
            className="flex flex-col gap-4 rounded-lg bg-muted p-4"
            aria-label="Como conectar"
          >
            <h3 className="title-3">No computador que executará os agentes</h3>
            <p className="body-6">
              Instale e autentique o Claude Code. No ambiente do runner, configure:
            </p>
            <dl className="body-6 flex flex-col gap-3">
              <div>
                <dt className="title-4 break-all">NEURONS_SERVER_URL</dt>
                <dd className="break-all select-all">{serverUrl}</dd>
              </div>
              <div>
                <dt className="title-4 break-all">NEURONS_RUNNER_TOKEN</dt>
                <dd>O token mostrado acima.</dd>
              </div>
            </dl>
            <p className="body-6">Com o projeto NeuronsAI instalado, execute:</p>
            <code className="caption-4 break-all">
              pnpm --filter @neurons/runner build
              <br />
              pnpm --filter @neurons/runner start
            </code>
            <p className="body-6">
              Mantenha o runner aberto. O computador aparecerá como Conectado nesta lista.
            </p>
          </section>
          <Button onClick={onClose}>Concluir</Button>
        </div>
      ) : (
        <form className="flex flex-col gap-6" onSubmit={(event) => void submit(event)}>
          <p className="body-6 text-muted-foreground">{text.intro}</p>
          <label className="title-4 flex flex-col gap-2">
            {text.label}
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              required
              disabled={busy}
            />
          </label>
          {error && (
            <p role="alert" className="body-6 text-destructive">
              {error}
            </p>
          )}
          <Button disabled={busy || !name.trim()}>
            {busy ? (kind === "personal" ? "Gerando…" : "Cadastrando…") : text.submit}
          </Button>
        </form>
      )}
    </Modal>
  );
}
