import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { canManage, useSession, type AccountSession } from "@/auth/session-context";
import { AccountRequired, CopyButton } from "@/components/account-ui";
import { Modal } from "@/components/modal";
import { EmptyState, ErrorState, LoadingRows } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiBaseUrl } from "@/config";
import { expectNoContent, unwrap, useApi } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export function RunnersPage() {
  const { account } = useSession();
  return account ? <Runners account={account} /> : <AccountRequired />;
}

function Runners({ account }: { account: AccountSession }) {
  const api = useApi();
  const client = useQueryClient();
  const runners = useQuery({
    queryKey: ["runners", account.organizationId],
    queryFn: () => unwrap(api.GET("/runners")),
    refetchInterval: 5_000,
  });
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function revoke() {
    if (!revoking) return;
    setBusy(true);
    setError("");
    try {
      await expectNoContent(
        api.DELETE("/runners/{name}", { params: { path: { name: revoking } } }),
      );
      setRevoking(null);
      await client.invalidateQueries({ queryKey: ["runners"] });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível revogar o runner.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="heading-4">Runners</h1>
          <p className="body-6 text-muted-foreground">
            Conecte seus computadores para executar agentes nesta organização.
          </p>
        </div>
        {canManage(account.role) && (
          <Button variant="accent" onClick={() => setCreating(true)}>
            Cadastrar runner
          </Button>
        )}
      </header>
      {!canManage(account.role) && (
        <p className="body-6 text-muted-foreground">
          Seu papel permite consultar os runners. Proprietários e administradores podem cadastrar e
          revogar.
        </p>
      )}
      {runners.isPending ? (
        <LoadingRows />
      ) : runners.error ? (
        <ErrorState error={runners.error} onRetry={() => void runners.refetch()} />
      ) : !runners.data.items.length ? (
        <EmptyState
          title="Nenhum computador cadastrado"
          hint="Cadastre um runner para obter o token de conexão desta organização."
        />
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Computadores da organização">
          {runners.data.items.map((runner) => (
            <li key={runner.id} className="flex flex-col gap-4 rounded-lg border bg-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-2">
                  <h2 className="title-3 break-words">{runner.name}</h2>
                  <span
                    className={`caption-4 self-start rounded-md px-3 py-2 ${runner.revokedAt ? "bg-muted text-muted-foreground" : runner.connected ? "bg-accent/20" : "bg-muted"}`}
                  >
                    {runner.revokedAt
                      ? "Revogado"
                      : runner.connected
                        ? "Conectado"
                        : "Desconectado"}
                  </span>
                </div>
                {canManage(account.role) && !runner.revokedAt && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Revogar ${runner.name}`}
                    onClick={() => {
                      setError("");
                      setRevoking(runner.name);
                    }}
                  >
                    Revogar
                  </Button>
                )}
              </div>
              <dl className="grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="caption-4 text-muted-foreground">Cadastrado em</dt>
                  <dd className="body-6 mt-1">{formatDateTime(runner.createdAt)}</dd>
                </div>
                <div>
                  <dt className="caption-4 text-muted-foreground">Última conexão</dt>
                  <dd className="body-6 mt-1">
                    {runner.lastSeenAt ? formatDateTime(runner.lastSeenAt) : "Ainda não conectou"}
                  </dd>
                </div>
                <div>
                  <dt className="caption-4 text-muted-foreground">Agentes vinculados</dt>
                  <dd className="body-6 mt-1">{runner.activeAgents}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
      <p className="caption-4 text-muted-foreground">
        O estado de conexão é atualizado a cada 5 segundos.
      </p>
      {creating && (
        <CreateRunner
          onClose={() => setCreating(false)}
          onCreated={() => {
            void client.invalidateQueries({ queryKey: ["runners"] });
          }}
        />
      )}
      {revoking && (
        <Modal
          title="Revogar runner"
          onClose={() => {
            if (!busy) setRevoking(null);
          }}
        >
          <div className="flex flex-col gap-6">
            <p className="body-6">
              O token de {revoking} deixará de funcionar. Se estiver conectado, o computador será
              desconectado na próxima verificação de acesso.
            </p>
            {error && (
              <p role="alert" className="body-6 text-destructive">
                {error}
              </p>
            )}
            <Button disabled={busy} onClick={() => void revoke()}>
              {busy ? "Revogando…" : "Confirmar revogação"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CreateRunner({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const api = useApi();
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
      const result = await unwrap(api.POST("/runners", { body: { name: name.trim() } }));
      setIssued({ name: result.name, token: result.token });
      onCreated();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível cadastrar o runner.");
    } finally {
      setBusy(false);
    }
  }
  const serverUrl = new URL(apiBaseUrl).origin;
  return (
    <Modal
      title={issued ? "Conectar computador" : "Cadastrar runner"}
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
          <p className="body-6 text-muted-foreground">
            Dê um nome ao computador. Você receberá um token para conectá-lo a este espaço.
          </p>
          <label className="title-4 flex flex-col gap-2">
            Nome do runner
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
            {busy ? "Cadastrando…" : "Gerar token de conexão"}
          </Button>
        </form>
      )}
    </Modal>
  );
}
