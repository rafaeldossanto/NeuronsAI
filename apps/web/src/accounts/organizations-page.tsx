import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  canManage,
  roleLabel,
  useSession,
  type AccountSession,
  type OrganizationRole,
} from "@/accounts/auth/session-context";
import { AccountRequired, CopyButton, RoleSelect } from "@/accounts/account-ui";
import { Modal } from "@/shared/modal";
import { ErrorState, LoadingRows } from "@/shared/states";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { expectNoContent, unwrap, useApi } from "@/shared/api";
import { InvitationsPanel } from "@/accounts/invitations-panel";

interface Member {
  userId: string;
  displayName: string;
  role: OrganizationRole;
}

export function OrganizationsPage() {
  const { account } = useSession();
  return account ? <Organizations account={account} /> : <AccountRequired />;
}

function Organizations({ account }: { account: AccountSession }) {
  const api = useApi();
  const client = useQueryClient();
  const session = useSession();
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: ({ signal }) => unwrap(api.GET("/auth/organizations", { signal })),
  });
  const members = useQuery({
    queryKey: ["members", account.organizationId],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/auth/organizations/{id}/members", {
          signal,
          params: { path: { id: account.organizationId } },
        }),
      ),
  });
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const list = members.data?.items ?? [];
  const role = list.find((item) => item.userId === account.userId)?.role ?? account.role;
  const current = organizations.data?.items.find((item) => item.id === account.organizationId);
  async function changeMember(userId: string, next: OrganizationRole | null) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await expectNoContent(
        api.PUT("/auth/organizations/{id}/members/{userId}", {
          params: { path: { id: account.organizationId, userId } },
          body: { role: next },
        }),
      );
      setAdding(false);
      setRemoving(null);
      setNotice(next === null ? "Membro removido." : "Papel salvo.");
      if (userId === account.userId) await session.reload();
      await Promise.all([
        client.invalidateQueries({ queryKey: ["members"] }),
        client.invalidateQueries({ queryKey: ["organizations"] }),
      ]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível salvar o membro.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="heading-4">Organizações</h1>
          <p className="body-6 text-muted-foreground">
            Escolha seu espaço de trabalho e gerencie quem participa.
          </p>
        </div>
        <Button
          variant="accent"
          onClick={() => {
            setError("");
            setCreating(true);
          }}
        >
          Criar organização
        </Button>
      </header>
      {!creating && !adding && !removing && error && (
        <p role="alert" className="body-6 text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="body-6">
          {notice}
        </p>
      )}
      <div className="grid items-start gap-8 lg:grid-cols-3">
        <aside className="flex min-w-0 flex-col gap-6" aria-label="Seus espaços">
          <section className="flex flex-col gap-4">
            <h2 className="title-3">Seus espaços</h2>
            {organizations.isPending ? (
              <LoadingRows rows={2} />
            ) : organizations.error ? (
              <ErrorState
                error={organizations.error}
                onRetry={() => void organizations.refetch()}
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {organizations.data.items.map((org) => (
                  <li key={org.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
                    <div className="flex flex-col gap-1">
                      <h3 className="title-3 break-words">{org.name}</h3>
                      <p className="caption-4 text-muted-foreground">{roleLabel[org.role]}</p>
                    </div>
                    {org.id === account.organizationId ? (
                      <span className="caption-4 self-start rounded-md bg-muted px-3 py-2">
                        Espaço atual
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void session.switchOrganization(org.id)}
                      >
                        Usar organização
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-3 rounded-lg bg-muted p-4" aria-label="Sua conta">
            <h2 className="title-4">ID da sua conta</h2>
            <p className="body-6 text-muted-foreground">
              Compartilhe este ID com quem vai adicionar você a uma organização.
            </p>
            <p className="caption-4 break-all select-all">{account.userId}</p>
            <CopyButton value={account.userId} label="Copiar ID" />
          </section>
        </aside>
        <section
          className="flex min-w-0 flex-col gap-6 lg:col-span-2"
          aria-label="Membros da organização"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="heading-5">Membros</h2>
              <p className="body-6 break-words text-muted-foreground">
                {current?.name ?? "Organização atual"}
              </p>
            </div>
            {canManage(role) && members.isSuccess && (
              <Button
                variant="outline"
                onClick={() => {
                  setError("");
                  setAdding(true);
                }}
              >
                Adicionar membro
              </Button>
            )}
          </div>
          {members.isPending ? (
            <LoadingRows />
          ) : members.error ? (
            <ErrorState error={members.error} onRetry={() => void members.refetch()} />
          ) : (
            <ul className="flex flex-col gap-3">
              {list.map((member) => {
                const lastOwner =
                  member.role === "owner" &&
                  list.filter((item) => item.role === "owner").length === 1;
                const editable =
                  canManage(role) &&
                  (role === "owner" || (member.role !== "owner" && member.role !== "admin")) &&
                  !lastOwner;
                return (
                  <MemberRow
                    key={`${member.userId}:${member.role}`}
                    member={member}
                    self={member.userId === account.userId}
                    owner={role === "owner"}
                    editable={editable}
                    lastOwner={lastOwner}
                    busy={busy}
                    onSave={(value) => void changeMember(member.userId, value)}
                    onRemove={() => {
                      setError("");
                      setRemoving(member);
                    }}
                  />
                );
              })}
            </ul>
          )}
          {canManage(role) && (
            <InvitationsPanel
              key={account.organizationId}
              organizationId={account.organizationId}
              owner={role === "owner"}
            />
          )}
          {role === "owner" && (
            <LocalDataAdoption
              organizationId={account.organizationId}
              organizationName={current?.name ?? "esta organização"}
            />
          )}
          <section
            className="flex flex-col gap-4 rounded-lg bg-muted p-6"
            aria-label="Permissões dos papéis"
          >
            <h3 className="title-3">Permissões dos papéis</h3>
            <dl className="body-6 grid gap-3 sm:grid-cols-[auto_1fr]">
              <dt className="title-4">Proprietário</dt>
              <dd>Gerencia projetos, membros, administradores, credenciais e runners.</dd>
              <dt className="title-4">Administrador</dt>
              <dd>Gerencia projetos, credenciais, runners, membros e leitores.</dd>
              <dt className="title-4">Membro</dt>
              <dd>Cria e edita projetos, inicia e acompanha execuções.</dd>
              <dt className="title-4">Leitor</dt>
              <dd>Consulta projetos, execuções, membros e runners.</dd>
            </dl>
          </section>
        </section>
      </div>
      {creating && (
        <CreateOrganization
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            setNotice("Organização criada. Escolha Usar organização para abri-la.");
            await client.invalidateQueries({ queryKey: ["organizations"] });
          }}
        />
      )}
      {adding && (
        <Modal
          title="Adicionar membro"
          onClose={() => {
            if (!busy) setAdding(false);
          }}
        >
          <AddMember
            owner={role === "owner"}
            existing={list.map((item) => item.userId)}
            busy={busy}
            error={error}
            onSubmit={(userId, value) => void changeMember(userId, value)}
          />
        </Modal>
      )}
      {removing && (
        <Modal
          title="Remover membro"
          onClose={() => {
            if (!busy) setRemoving(null);
          }}
        >
          <div className="flex flex-col gap-6">
            <p className="body-6">
              {removing.displayName} perderá acesso aos projetos e às execuções desta organização.
              {removing.userId === account.userId && " Sua sessão neste espaço será encerrada."}
            </p>
            {error && (
              <p role="alert" className="body-6 text-destructive">
                {error}
              </p>
            )}
            <Button disabled={busy} onClick={() => void changeMember(removing.userId, null)}>
              {busy ? "Removendo…" : "Confirmar remoção"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MemberRow({
  member,
  self,
  owner,
  editable,
  lastOwner,
  busy,
  onSave,
  onRemove,
}: {
  member: Member;
  self: boolean;
  owner: boolean;
  editable: boolean;
  lastOwner: boolean;
  busy: boolean;
  onSave: (role: OrganizationRole) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState(member.role);
  return (
    <li className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h3 className="title-3 break-words">
          {member.displayName}
          {self && <span className="caption-4 text-muted-foreground"> · Você</span>}
        </h3>
        <p className="caption-4 break-all text-muted-foreground">{member.userId}</p>
      </div>
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <RoleSelect
            label={`Papel de ${member.displayName}`}
            value={value}
            onChange={setValue}
            owner={owner}
            disabled={busy}
          />
          <Button size="sm" disabled={busy || value === member.role} onClick={() => onSave(value)}>
            Salvar papel
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            aria-label={`Remover ${member.displayName}`}
            onClick={onRemove}
          >
            Remover
          </Button>
        </div>
      ) : (
        <p className="body-6">
          {roleLabel[member.role]}
          {lastOwner && (
            <span className="caption-4 text-muted-foreground">
              {" "}
              · É preciso manter um proprietário.
            </span>
          )}
        </p>
      )}
    </li>
  );
}

function AddMember({
  owner,
  existing,
  busy,
  error,
  onSubmit,
}: {
  owner: boolean;
  existing: string[];
  busy: boolean;
  error: string;
  onSubmit: (userId: string, role: OrganizationRole) => void;
}) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<OrganizationRole>("member");
  const [invalid, setInvalid] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const id = userId.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      setInvalid("Informe um ID de conta válido.");
      return;
    }
    if (existing.includes(id)) {
      setInvalid("Esta conta já participa da organização. Altere o papel na lista de membros.");
      return;
    }
    setInvalid("");
    onSubmit(id, role);
  }
  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <p className="body-6 text-muted-foreground">
        Peça à pessoa o ID mostrado em Organizações. Ela precisa já ter entrado no NeuronsAI.
      </p>
      <label className="title-4 flex flex-col gap-2">
        ID da conta
        <Input
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          required
          maxLength={36}
          disabled={busy}
          autoComplete="off"
        />
      </label>
      <label className="title-4 flex flex-col gap-2">
        Papel
        <RoleSelect
          label="Papel do novo membro"
          value={role}
          onChange={setRole}
          owner={owner}
          disabled={busy}
        />
      </label>
      {(invalid || error) && (
        <p role="alert" className="body-6 text-destructive">
          {invalid || error}
        </p>
      )}
      <Button disabled={busy}>{busy ? "Adicionando…" : "Adicionar à organização"}</Button>
    </form>
  );
}

function CreateOrganization({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const api = useApi();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await unwrap(api.POST("/auth/organizations", { body: { name: name.trim() } }));
      await onCreated();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Não foi possível criar a organização.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Criar organização"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="flex flex-col gap-6" onSubmit={(event) => void submit(event)}>
        <p className="body-6 text-muted-foreground">Você será o proprietário do novo espaço.</p>
        <label className="title-4 flex flex-col gap-2">
          Nome da organização
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            required
            disabled={busy}
          />
        </label>
        {error && (
          <p role="alert" className="body-6 text-destructive">
            {error}
          </p>
        )}
        <Button disabled={busy || !name.trim()}>{busy ? "Criando…" : "Criar espaço"}</Button>
      </form>
    </Modal>
  );
}

interface LocalData {
  graphs: number;
  versions: number;
  runs: number;
  secrets: number;
  triggers: number;
  memories: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * For owners only: the data made before the server had accounts (the "local" workspace) can be
 * moved into this organization, once and after a confirmation. It is never done by itself.
 */
function LocalDataAdoption({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const api = useApi();
  const client = useQueryClient();
  const found = useQuery({
    queryKey: ["local-data", organizationId],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/auth/organizations/{id}/local-data", {
          signal,
          params: { path: { id: organizationId } },
        }),
      ),
    retry: false,
  });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<LocalData | null>(null);
  const data = found.data;
  const hasData = data && Object.values(data).some((n) => n > 0);

  async function adopt() {
    setBusy(true);
    setError("");
    try {
      const moved = await unwrap(
        api.POST("/auth/organizations/{id}/adopt-local-data", {
          params: { path: { id: organizationId } },
          body: { confirm: true },
        }),
      );
      setDone(moved);
      setConfirming(false);
      // Adopting local data moves graphs, runs, memories, connections and more into this organization:
      // nearly every cached query changed, so the unscoped invalidation is intended.
      await client.invalidateQueries();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível mover os dados.");
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <p role="status" className="body-6 rounded-lg bg-muted p-4">
        Dados locais movidos para {organizationName}: {plural(done.graphs, "projeto", "projetos")},{" "}
        {plural(done.runs, "execução", "execuções")}, {plural(done.secrets, "segredo", "segredos")}{" "}
        e {plural(done.memories, "memória", "memórias")}. Gatilhos com agenda ficam desligados:
        ligue-os de novo.
      </p>
    );
  if (!hasData) return null;
  return (
    <section
      className="flex flex-col gap-4 rounded-lg border bg-card p-6"
      aria-label="Dados locais"
    >
      <h3 className="title-3">Dados locais deste servidor</h3>
      <p className="body-6 text-muted-foreground">
        Este servidor tem dados criados antes das contas:{" "}
        {plural(data.graphs, "projeto", "projetos")}, {plural(data.runs, "execução", "execuções")},{" "}
        {plural(data.secrets, "segredo", "segredos")} e{" "}
        {plural(data.memories, "memória", "memórias")}. Eles não aparecem em nenhuma organização até
        você movê-los.
      </p>
      <Button variant="outline" className="self-start" onClick={() => setConfirming(true)}>
        Mover dados locais para esta organização
      </Button>
      {confirming && (
        <Modal
          title="Mover dados locais"
          onClose={() => {
            if (!busy) setConfirming(false);
          }}
        >
          <div className="flex flex-col gap-6">
            <p className="body-6">
              Tudo isso passará a pertencer a <strong>{organizationName}</strong> e será visível
              para todos os membros. Não dá para desfazer. Os segredos serão recriptografados.
              Gatilhos com agenda ficam desligados até você ligá-los de novo. A ação é recusada se
              houver execuções locais em andamento.
            </p>
            {error && (
              <p role="alert" className="body-6 text-destructive">
                {error}
              </p>
            )}
            <Button disabled={busy} onClick={() => void adopt()}>
              {busy ? "Movendo…" : "Confirmar e mover"}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
