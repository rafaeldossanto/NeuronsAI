import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { GraphAccessDialog } from "./graph-access-dialog";
import { useCancelGraphAccessRequest, useRequestGraphAccess } from "./queries";

/** The slice of a project the access controls read (a list item, or the project itself). */
export interface AccessProject {
  id: string;
  name: string;
  access: { level: string; request: "pending" | "blocked" | null; pendingRequests: number };
}

/** Whether the person decides who gets into the project (never in the local workspace). */
export const managesAccess = (project: AccessProject): boolean => project.access.level === "manage";

export const pendingRequestsLabel = (count: number): string =>
  count === 1 ? "1 pedido de acesso" : `${String(count)} pedidos de acesso`;

/**
 * The "Acesso" button that opens the dialog, with a badge for the requests waiting. Render it only
 * for who manages the project (see {@link managesAccess}); the server refuses anyone else.
 */
export function GraphAccessButton({ project }: { project: AccessProject }) {
  const [open, setOpen] = useState(false);
  const pending = project.access.pendingRequests;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Gerenciar acesso a ${project.name}`}
        onClick={() => setOpen(true)}
      >
        <Lock className="size-4" aria-hidden="true" />
        Acesso
      </Button>
      {pending > 0 && (
        <button
          type="button"
          className="inline-flex items-center rounded-full border border-accent bg-accent/15 px-2.5 py-0.5 text-xs font-semibold"
          aria-label={`${pendingRequestsLabel(pending)} em ${project.name}: abrir o acesso`}
          onClick={() => setOpen(true)}
        >
          {pendingRequestsLabel(pending)}
        </button>
      )}
      {open && <GraphAccessDialog graph={project} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * What a person without access to a project may do about it: ask the owner, take the request back,
 * or nothing when the owner shut them out.
 */
export function AccessRequestControls({ project }: { project: AccessProject }) {
  const request = useRequestGraphAccess();
  const cancel = useCancelGraphAccessRequest();
  const failure = request.error ?? cancel.error;
  const state = project.access.request;
  return (
    <>
      {state === "blocked" && (
        <p className="text-xs font-semibold text-muted-foreground">Acesso bloqueado pelo dono</p>
      )}
      {state === "pending" && (
        <>
          <span className="text-xs font-semibold text-muted-foreground">Pedido enviado</span>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Cancelar pedido de acesso a ${project.name}`}
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(project.id)}
          >
            {cancel.isPending ? "Cancelando…" : "Cancelar pedido"}
          </Button>
        </>
      )}
      {state === null && (
        <Button
          variant="outline"
          size="sm"
          aria-label={`Solicitar acesso a ${project.name}`}
          disabled={request.isPending}
          onClick={() => request.mutate(project.id)}
        >
          {request.isPending ? "Solicitando…" : "Solicitar acesso"}
        </Button>
      )}
      {failure && (
        <p role="alert" className="basis-full text-right text-xs font-semibold text-destructive">
          {failure.message}
        </p>
      )}
    </>
  );
}
