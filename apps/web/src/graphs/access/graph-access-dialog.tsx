import { useId, useState } from "react";
import { ConfirmDialog } from "@/shared/confirm-dialog";
import { Modal } from "@/shared/modal";
import { ErrorState, LoadingRows } from "@/shared/states";
import { Button } from "@/shared/ui/button";
import { Select } from "@/shared/ui/select";
import {
  useGraphAccess,
  useOrganizationMembers,
  useRemoveGraphAccess,
  useSetGraphAccess,
  useSetGraphAccessMode,
} from "./queries";

type Level = "use" | "edit";
type Mode = "organization" | "restricted";

export const levelLabel: Record<Level, string> = { use: "Pode usar", edit: "Pode editar" };

const modes: { value: Mode; label: string; hint: string }[] = [
  {
    value: "restricted",
    label: "Restrito",
    hint: "Só o dono, os administradores da organização e as pessoas que você liberar abrem o projeto.",
  },
  {
    value: "organization",
    label: "Aberto à organização",
    hint: "Todos os membros abrem o projeto com o acesso do papel que têm. Quem foi bloqueado continua sem acesso.",
  },
];

const roleNote: Record<string, string> = {
  viewer: " (leitor: só visualiza)",
};

interface Person {
  id: string;
  name: string;
  email: string | null;
}

/**
 * Who gets into a project, for the people who manage it (the project's owner, and the owners and
 * admins of the organization): the mode, the people let in (to use or to edit), the ones shut out
 * and the requests waiting for an answer. The server decides it all again.
 */
export function GraphAccessDialog({
  graph,
  onClose,
}: {
  graph: { id: string; name: string };
  onClose: () => void;
}) {
  const access = useGraphAccess(graph.id);
  const members = useOrganizationMembers();
  const setMode = useSetGraphAccessMode(graph.id);
  const setAccess = useSetGraphAccess(graph.id);
  const remove = useRemoveGraphAccess(graph.id);
  const [blocking, setBlocking] = useState<Person | null>(null);
  const modeName = useId();
  const failure = setMode.error ?? setAccess.error ?? remove.error;

  return (
    <Modal title="Acesso ao projeto" onClose={onClose}>
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">Projeto “{graph.name}”.</p>
      {access.isPending && <LoadingRows rows={3} label="Carregando acesso" />}
      {access.isError && <ErrorState error={access.error} onRetry={() => void access.refetch()} />}
      {access.isSuccess && (
        <AccessBody
          data={access.data}
          modeName={modeName}
          members={members.data?.items ?? []}
          busy={setMode.isPending || setAccess.isPending || remove.isPending}
          onMode={(mode) => setMode.mutate(mode)}
          onGrant={(userId, level) => setAccess.mutate({ userId, status: "granted", level })}
          onBlock={setBlocking}
          onRemove={(userId) => remove.mutate(userId)}
        />
      )}
      {failure && !blocking && (
        <p role="alert" className="mt-4 text-sm font-semibold text-destructive">
          {failure.message}
        </p>
      )}
      {blocking && (
        <ConfirmDialog
          title={`Bloquear ${blocking.name}?`}
          description={`${blocking.name} fica sem acesso a “${graph.name}” e não poderá pedir acesso de novo, mesmo que o projeto seja aberto à organização. Você pode desbloquear depois.`}
          confirmLabel="Bloquear"
          pendingLabel="Bloqueando…"
          pending={setAccess.isPending}
          error={setAccess.isError ? setAccess.error.message : null}
          onCancel={() => {
            setAccess.reset();
            setBlocking(null);
          }}
          onConfirm={() =>
            setAccess.mutate(
              { userId: blocking.id, status: "blocked" },
              { onSuccess: () => setBlocking(null) },
            )
          }
        />
      )}
    </Modal>
  );
}

type AccessData = NonNullable<ReturnType<typeof useGraphAccess>["data"]>;

function AccessBody({
  data,
  modeName,
  members,
  busy,
  onMode,
  onGrant,
  onBlock,
  onRemove,
}: {
  data: AccessData;
  modeName: string;
  members: { userId: string; displayName: string; role: string }[];
  busy: boolean;
  onMode: (mode: Mode) => void;
  onGrant: (userId: string, level: Level) => void;
  onBlock: (person: Person) => void;
  onRemove: (userId: string) => void;
}) {
  const requests = data.entries.filter((entry) => entry.status === "requested");
  const people = data.entries.filter((entry) => entry.status !== "requested");
  const known = new Set(data.entries.map((entry) => entry.user.id));
  // Owners, admins and the project's owner already have everything: there is nothing to give them.
  const addable = members.filter(
    (member) =>
      !known.has(member.userId) &&
      member.userId !== data.owner?.id &&
      member.role !== "owner" &&
      member.role !== "admin",
  );

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2" disabled={busy}>
        <legend className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Quem pode abrir
        </legend>
        {modes.map((mode) => (
          <label key={mode.value} className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="radio"
              name={modeName}
              className="mt-1"
              checked={data.mode === mode.value}
              onChange={() => onMode(mode.value)}
            />
            <span>
              <span className="font-semibold">{mode.label}</span>
              <span className="block text-muted-foreground">{mode.hint}</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-muted-foreground">
          {data.owner ? `Dono: ${data.owner.name}. ` : "Projeto sem dono registrado. "}
          Proprietários e administradores da organização sempre têm acesso total.
        </p>
      </fieldset>

      {requests.length > 0 && (
        <section aria-label="Pedidos de acesso" className="flex flex-col gap-2">
          <h3 className="text-sm font-bold">Pedidos de acesso</h3>
          <ul className="flex flex-col gap-2">
            {requests.map((entry) => (
              <PendingRequest
                key={entry.user.id}
                person={entry.user}
                busy={busy}
                onApprove={(level) => onGrant(entry.user.id, level)}
                onRefuse={() => onRemove(entry.user.id)}
                onBlock={() => onBlock(entry.user)}
              />
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Pessoas com acesso" className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">Pessoas</h3>
        {people.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ninguém foi liberado nem bloqueado ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {people.map((entry) => {
              const blocked = entry.status === "blocked";
              return (
                <li key={entry.user.id} className="flex flex-wrap items-center gap-2">
                  <PersonName person={entry.user} />
                  <Select
                    aria-label={`Acesso de ${entry.user.name}`}
                    value={blocked ? "blocked" : (entry.level ?? "use")}
                    disabled={busy}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "blocked") onBlock(entry.user);
                      else onGrant(entry.user.id, value as Level);
                    }}
                  >
                    <option value="use">{levelLabel.use}</option>
                    <option value="edit">{levelLabel.edit}</option>
                    <option value="blocked">Bloqueado</option>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={
                      blocked
                        ? `Desbloquear ${entry.user.name}`
                        : `Tirar acesso de ${entry.user.name}`
                    }
                    onClick={() => onRemove(entry.user.id)}
                  >
                    {blocked ? "Desbloquear" : "Tirar"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AddPerson
        candidates={addable}
        busy={busy}
        onAdd={(userId, level) => onGrant(userId, level)}
      />
    </div>
  );
}

function PersonName({ person }: { person: Person }) {
  return (
    <span className="min-w-0 flex-1 basis-40 truncate text-sm">
      <span className="font-semibold">{person.name}</span>
      {person.email && <span className="ml-2 text-xs text-muted-foreground">{person.email}</span>}
    </span>
  );
}

function PendingRequest({
  person,
  busy,
  onApprove,
  onRefuse,
  onBlock,
}: {
  person: Person;
  busy: boolean;
  onApprove: (level: Level) => void;
  onRefuse: () => void;
  onBlock: () => void;
}) {
  const [level, setLevel] = useState<Level>("use");
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
      <PersonName person={person} />
      <Select
        aria-label={`Nível para ${person.name}`}
        value={level}
        disabled={busy}
        onChange={(event) => setLevel(event.target.value as Level)}
      >
        <option value="use">{levelLabel.use}</option>
        <option value="edit">{levelLabel.edit}</option>
      </Select>
      <Button
        size="sm"
        disabled={busy}
        aria-label={`Aprovar pedido de ${person.name}`}
        onClick={() => onApprove(level)}
      >
        Aprovar
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        aria-label={`Recusar pedido de ${person.name}`}
        onClick={onRefuse}
      >
        Recusar
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        aria-label={`Bloquear ${person.name}`}
        onClick={onBlock}
      >
        Bloquear
      </Button>
    </li>
  );
}

function AddPerson({
  candidates,
  busy,
  onAdd,
}: {
  candidates: { userId: string; displayName: string; role: string }[];
  busy: boolean;
  onAdd: (userId: string, level: Level) => void;
}) {
  const [userId, setUserId] = useState("");
  const [level, setLevel] = useState<Level>("use");
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      aria-label="Adicionar pessoa"
      onSubmit={(event) => {
        event.preventDefault();
        if (!userId) return;
        onAdd(userId, level);
        setUserId("");
      }}
    >
      <Select
        aria-label="Pessoa da organização"
        value={userId}
        disabled={busy || candidates.length === 0}
        onChange={(event) => setUserId(event.target.value)}
      >
        <option value="">
          {candidates.length === 0 ? "Todos já têm acesso definido" : "Escolha uma pessoa"}
        </option>
        {candidates.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.displayName}
            {roleNote[member.role] ?? ""}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Nível da nova pessoa"
        value={level}
        disabled={busy}
        onChange={(event) => setLevel(event.target.value as Level)}
      >
        <option value="use">{levelLabel.use}</option>
        <option value="edit">{levelLabel.edit}</option>
      </Select>
      <Button type="submit" size="sm" disabled={busy || !userId}>
        Adicionar pessoa
      </Button>
    </form>
  );
}
