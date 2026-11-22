import { useState } from "react";
import { Link } from "react-router";
import { Trash2 } from "lucide-react";
import { canManage, useSession } from "@/accounts/auth/session-context";
import { ConfirmDialog } from "@/shared/confirm-dialog";
import { formatDateTime } from "@/shared/format";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { DeleteProjectDialog } from "@/graphs/delete-project-dialog";
import {
  useCancelGraphDeletionRequest,
  useRejectGraphDeletionRequest,
  useRequestGraphDeletion,
  type useGraphs,
} from "@/graphs/queries";

type Project = NonNullable<ReturnType<typeof useGraphs>["data"]>[number];
type Dialog = "delete" | "approve" | "request" | null;

const dangerHover =
  "text-muted-foreground hover:border-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:border-destructive focus-visible:text-destructive";

/**
 * One project in the list. What may be done with it depends on the role: an owner or admin deletes
 * (and answers a member's request), a member asks, a viewer only opens it. Without accounts (the
 * local workspace) the single user deletes directly. The server decides all of this again.
 */
export function ProjectCard({ graph }: { graph: Project }) {
  const { account } = useSession();
  const manager = account === null || canManage(account.role);
  const member = account?.role === "member";
  const request = graph.deletionRequest ?? null;
  const mine = request !== null && account !== null && request.requestedBy.id === account.userId;
  const [dialog, setDialog] = useState<Dialog>(null);
  const reject = useRejectGraphDeletionRequest();
  const cancel = useCancelGraphDeletionRequest();
  const failure = reject.error ?? cancel.error;
  const close = () => setDialog(null);

  return (
    <Card className="flex flex-col gap-2 p-4 transition-colors hover:border-accent">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link to={`/graphs/${graph.id}`} className="block truncate font-bold hover:underline">
            {graph.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            Atualizado em {formatDateTime(graph.updatedAt)}
          </p>
          {request && (manager || member) && (
            <p className="mt-1 text-xs font-semibold text-destructive">
              {manager
                ? `Exclusão solicitada por ${request.requestedBy.name} em ${formatDateTime(request.requestedAt)}`
                : "Exclusão solicitada"}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/graphs/${graph.id}`} aria-label={`Abrir ${graph.name}`}>
              Abrir
            </Link>
          </Button>
          {manager && request && (
            <>
              <Button
                variant="outline"
                size="sm"
                className={dangerHover}
                aria-label={`Aprovar exclusão de ${graph.name}`}
                onClick={() => setDialog("approve")}
              >
                Aprovar exclusão
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Recusar exclusão de ${graph.name}`}
                disabled={reject.isPending}
                onClick={() => reject.mutate(graph.id)}
              >
                {reject.isPending ? "Recusando…" : "Recusar"}
              </Button>
            </>
          )}
          {manager && (
            <Button
              variant="outline"
              size="sm"
              title="Excluir projeto"
              aria-label={`Excluir ${graph.name}`}
              className={dangerHover}
              onClick={() => setDialog("delete")}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          )}
          {member && !request && (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Solicitar exclusão de ${graph.name}`}
              onClick={() => {
                setDialog("request");
              }}
            >
              Solicitar exclusão
            </Button>
          )}
          {member && request && mine && (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Cancelar solicitação de exclusão de ${graph.name}`}
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(graph.id)}
            >
              {cancel.isPending ? "Cancelando…" : "Cancelar solicitação"}
            </Button>
          )}
        </div>
      </div>
      {failure && (
        <p role="alert" className="text-xs font-semibold text-destructive">
          {failure.message}
        </p>
      )}
      {(dialog === "delete" || dialog === "approve") && (
        <DeleteProjectDialog project={graph} onClose={close} approving={dialog === "approve"} />
      )}
      {dialog === "request" && <RequestDeletionDialog project={graph} onClose={close} />}
    </Card>
  );
}

function RequestDeletionDialog({
  project,
  onClose,
}: {
  project: { id: string; name: string };
  onClose: () => void;
}) {
  const request = useRequestGraphDeletion();
  return (
    <ConfirmDialog
      title="Solicitar exclusão?"
      description={`Pedir a exclusão de “${project.name}”? Um administrador vai aprovar ou recusar.`}
      confirmLabel="Solicitar"
      pendingLabel="Solicitando…"
      tone="default"
      pending={request.isPending}
      error={request.isError ? request.error.message : null}
      onCancel={onClose}
      onConfirm={() => request.mutate(project.id, { onSuccess: onClose })}
    />
  );
}
