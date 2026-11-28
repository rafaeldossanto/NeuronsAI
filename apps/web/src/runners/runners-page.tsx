import { useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { canManage, useSession, type AccountSession } from "@/accounts/auth/session-context";
import { AccountRequired } from "@/accounts/account-ui";
import { Modal } from "@/shared/modal";
import { EmptyState, ErrorState, LoadingRows } from "@/shared/states";
import { Button } from "@/shared/ui/button";
import { expectNoContent, unwrap, useApi } from "@/shared/api";
import { formatDateTime } from "@/shared/format";
import { CreateRunner } from "./create-runner";
import { PersonalRunners } from "./personal-runners";

const TABS = [
  { id: "personal", label: "Pessoal" },
  { id: "organization", label: "Organização" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function RunnersPage() {
  const { account } = useSession();
  return account ? <Runners account={account} /> : <AccountRequired />;
}

function Runners({ account }: { account: AccountSession }) {
  const [tab, setTab] = useState<TabId>("personal");
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    personal: null,
    organization: null,
  });
  // Arrow keys, Home and End move between tabs (the selected one is the only one in the tab order).
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TABS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const target = TABS[next]!.id;
    setTab(target);
    tabRefs.current[target]?.focus();
  }
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="heading-4">Runners</h1>
        <p className="body-6 text-muted-foreground">
          Conecte computadores para executar agentes: o seu, que roda só o que você iniciar, ou os
          da organização.
        </p>
      </header>
      <div role="tablist" aria-label="Tipo de runner" className="flex gap-2 border-b">
        {TABS.map((item, index) => (
          <button
            key={item.id}
            ref={(element) => {
              tabRefs.current[item.id] = element;
            }}
            type="button"
            role="tab"
            id={`runners-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`runners-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className={`title-4 -mb-px border-b-2 px-4 py-3 ${tab === item.id ? "border-foreground" : "border-transparent text-muted-foreground"}`}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`runners-panel-${tab}`}
        aria-labelledby={`runners-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "personal" ? (
          <PersonalRunners account={account} />
        ) : (
          <OrganizationRunners account={account} />
        )}
      </div>
    </div>
  );
}

function OrganizationRunners({ account }: { account: AccountSession }) {
  const api = useApi();
  const client = useQueryClient();
  const runners = useQuery({
    queryKey: ["runners", account.organizationId],
    queryFn: ({ signal }) => unwrap(api.GET("/runners", { signal })),
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="body-6 max-w-prose text-muted-foreground">
          Um computador da organização roda execuções de qualquer membro e as agendadas ou por
          webhook, com a assinatura logada nele.
        </p>
        {canManage(account.role) && (
          <Button variant="accent" onClick={() => setCreating(true)}>
            Cadastrar runner
          </Button>
        )}
      </div>
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
          kind="organization"
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
