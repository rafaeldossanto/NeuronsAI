import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrganizationRole } from "@/accounts/auth/session-context";
import { RoleSelect } from "@/accounts/account-ui";
import { ErrorState, LoadingRows } from "@/shared/states";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { expectNoContent, unwrap, useApi } from "@/shared/api";

export function InvitationsPanel({
  organizationId,
  owner,
}: {
  organizationId: string;
  owner: boolean;
}) {
  const api = useApi(),
    client = useQueryClient();
  const [email, setEmail] = useState(""),
    [role, setRole] = useState<OrganizationRole>("member");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const key = ["invitations", organizationId];
  const invitations = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/auth/organizations/{id}/invitations", {
          params: { path: { id: organizationId } },
          signal,
        }),
      ),
  });
  async function perform(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(message);
      await client.invalidateQueries({ queryKey: key });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível salvar o convite.");
    } finally {
      setBusy(false);
    }
  }
  function invite(event: FormEvent) {
    event.preventDefault();
    void perform(async () => {
      await unwrap(
        api.POST("/auth/organizations/{id}/invitations", {
          params: { path: { id: organizationId } },
          body: { email: email.trim(), role },
        }),
      );
      setEmail("");
    }, "Convite criado. A pessoa pode entrar com esse e-mail.");
  }
  return (
    <section className="flex flex-col gap-4" aria-label="Convites da organização">
      <div className="flex flex-col gap-2">
        <h2 className="heading-5">Convites</h2>
        <p className="body-6 text-muted-foreground">
          Autorize uma pessoa pelo e-mail usado no Google. Compartilhe o endereço do aplicativo com
          ela; o convite não envia uma mensagem automaticamente.
        </p>
      </div>
      <form
        onSubmit={invite}
        className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
      >
        <label className="body-6 flex min-w-0 flex-1 flex-col gap-2">
          E-mail do convite
          <Input
            type="email"
            required
            maxLength={320}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
          />
        </label>
        <RoleSelect
          label="Papel do convite"
          value={role}
          onChange={setRole}
          owner={owner}
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !email.trim()}>
          {busy ? "Salvando…" : "Criar convite"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="body-6 text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="body-6">
          {notice}
        </p>
      )}
      {invitations.isPending ? (
        <LoadingRows rows={2} />
      ) : invitations.error ? (
        <ErrorState error={invitations.error} onRetry={() => void invitations.refetch()} />
      ) : invitations.data.items.length === 0 ? (
        <p className="body-6 text-muted-foreground">Nenhum convite pendente.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {invitations.data.items.map((invite) => (
            <li
              key={invite.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4"
            >
              <div className="flex min-w-0 flex-col gap-2">
                <span className="body-6 break-all">{invite.email}</span>
                <span className="caption-4 text-muted-foreground">
                  Expira em {new Date(invite.expiresAt).toLocaleDateString("pt-BR")}
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                aria-label={`Cancelar convite de ${invite.email}`}
                onClick={() =>
                  void perform(
                    () =>
                      expectNoContent(
                        api.DELETE("/auth/organizations/{id}/invitations/{invitationId}", {
                          params: { path: { id: organizationId, invitationId: invite.id } },
                        }),
                      ),
                    "Convite cancelado.",
                  )
                }
              >
                Cancelar convite
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
