import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccountSession } from "@/accounts/auth/session-context";
import { ConfirmDialog } from "@/shared/confirm-dialog";
import { EmptyState, ErrorState, LoadingRows } from "@/shared/states";
import { Button } from "@/shared/ui/button";
import { expectNoContent, unwrap, useApi } from "@/shared/api";
import { formatDateTime } from "@/shared/format";
import { CreateRunner } from "./create-runner";

/** The member's own computers: they run only what that member starts. */
export function PersonalRunners({ account }: { account: AccountSession }) {
  // A viewer cannot start runs, so there is nothing to connect.
  if (account.role === "viewer") {
    return (
      <p className="body-6 text-muted-foreground">
        Para conectar o seu computador você precisa de permissão para executar projetos. Peça a um
        proprietário ou administrador para mudar o seu papel.
      </p>
    );
  }
  return <PersonalList account={account} />;
}

function PersonalList({ account }: { account: AccountSession }) {
  const api = useApi();
  const client = useQueryClient();
  const runners = useQuery({
    queryKey: ["runners", "personal", account.organizationId, account.userId],
    queryFn: ({ signal }) => unwrap(api.GET("/runners/personal", { signal })),
    refetchInterval: 5_000,
  });
  const [generating, setGenerating] = useState(false);
  const [disconnecting, setDisconnecting] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function disconnect() {
    if (!disconnecting) return;
    setBusy(true);
    setError("");
    try {
      await expectNoContent(
        api.DELETE("/runners/personal/{id}", { params: { path: { id: disconnecting.id } } }),
      );
      setDisconnecting(null);
      await client.invalidateQueries({ queryKey: ["runners"] });
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Não foi possível desconectar o computador.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-6">
      <p className="body-6 text-muted-foreground">
        Abra o app do NeuronsAI no seu computador e entre na sua conta: ele se conecta sozinho e
        roda só as execuções que você iniciar, com a assinatura logada nele.
      </p>
      {runners.isPending ? (
        <LoadingRows />
      ) : runners.error ? (
        <ErrorState error={runners.error} onRetry={() => void runners.refetch()} />
      ) : !runners.data.items.length ? (
        <EmptyState
          title="Nenhum computador seu conectado"
          hint="Entre na sua conta pelo app do NeuronsAI e ele aparece aqui."
        />
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Seus computadores">
          {runners.data.items.map((runner) => (
            <li key={runner.id} className="flex flex-col gap-4 rounded-lg border bg-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-2">
                  <h2 className="title-3 break-words">{runner.name}</h2>
                  <span
                    className={`caption-4 self-start rounded-md px-3 py-2 ${runner.connected ? "bg-accent/20" : "bg-muted"}`}
                  >
                    {runner.connected ? "Conectado" : "Desconectado"}
                  </span>
                </div>
                {!runner.revokedAt && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Desconectar ${runner.name}`}
                    onClick={() => {
                      setError("");
                      setDisconnecting({ id: runner.id, name: runner.name });
                    }}
                  >
                    Desconectar
                  </Button>
                )}
              </div>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="caption-4 text-muted-foreground">Agentes ativos</dt>
                  <dd className="body-6 mt-1">{runner.activeAgents}</dd>
                </div>
                <div>
                  <dt className="caption-4 text-muted-foreground">Visto por último</dt>
                  <dd className="body-6 mt-1">
                    {runner.lastSeenAt ? formatDateTime(runner.lastSeenAt) : "Ainda não conectou"}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
      <p className="caption-4 text-muted-foreground">
        O estado de conexão é atualizado a cada 5 segundos.
      </p>
      <details className="rounded-lg border p-4">
        <summary className="title-4 cursor-pointer">Avançado: rodar o runner à mão</summary>
        <div className="mt-4 flex flex-col gap-4">
          <p className="body-6 text-muted-foreground">
            Para um computador sem o app, gere um token e rode o <code>neurons-runner</code> nele. O
            token vale só para as suas execuções.
          </p>
          <Button className="self-start" variant="outline" onClick={() => setGenerating(true)}>
            Gerar token
          </Button>
        </div>
      </details>
      {generating && (
        <CreateRunner
          kind="personal"
          onClose={() => setGenerating(false)}
          onCreated={() => {
            void client.invalidateQueries({ queryKey: ["runners"] });
          }}
        />
      )}
      {disconnecting && (
        <ConfirmDialog
          title="Desconectar computador?"
          description={
            <>
              O token de {disconnecting.name} deixará de funcionar e o computador será desconectado.
              Para voltar, entre de novo na sua conta pelo app.
            </>
          }
          confirmLabel="Desconectar"
          pendingLabel="Desconectando…"
          pending={busy}
          error={error}
          onConfirm={() => void disconnect()}
          onCancel={() => setDisconnecting(null)}
        />
      )}
    </div>
  );
}
