import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { EmptyState, ErrorState, LoadingRows } from "@/shared/states";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { formatDateTime } from "@/shared/format";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/shared/confirm-dialog";
import { ApiError } from "@/shared/api";
import { useCreateGraph, useDeleteGraph, useGraphs } from "@/graphs/queries";

/** The list does not say which projects are published, so the server's refusal is explained here. */
function deleteErrorMessage(error: Error): string {
  if (error instanceof ApiError && error.code === "graph_has_versions") {
    return "Projetos com versão publicada não podem ser excluídos.";
  }
  return error.message;
}

export function GraphsPage() {
  const graphs = useGraphs();
  const create = useCreateGraph();
  const remove = useDeleteGraph();
  const [name, setName] = useState("");
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(trimmed, { onSuccess: () => setName("") });
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Meus projetos</h1>
        <p className="mt-1 text-muted-foreground">
          Cada projeto é um time de agentes ligados por setas.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row" aria-label="Novo projeto">
        <Input
          aria-label="Nome do novo projeto"
          placeholder="Nome do novo projeto"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="accent" disabled={create.isPending || !name.trim()}>
          {create.isPending ? "Criando…" : "Criar projeto"}
        </Button>
      </form>
      <p className="-mt-4 text-sm text-muted-foreground">
        Prefere partir de um exemplo?{" "}
        <Link to="/new" className="font-semibold text-foreground underline underline-offset-2">
          Ver modelos
        </Link>
      </p>
      {create.isError && <ErrorState error={create.error} />}

      {graphs.isPending && <LoadingRows label="Carregando projetos" />}
      {graphs.isError && <ErrorState error={graphs.error} onRetry={() => void graphs.refetch()} />}
      {graphs.isSuccess && graphs.data.length === 0 && (
        <EmptyState
          title="Nenhum projeto ainda"
          hint="Dê um nome no campo acima para começar do zero, ou parta de um modelo pronto."
        />
      )}
      {graphs.isSuccess && graphs.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {graphs.data.map((graph) => (
            <li key={graph.id}>
              <Card className="flex items-center justify-between gap-4 p-4 transition-colors hover:border-accent">
                <div className="min-w-0">
                  <Link
                    to={`/graphs/${graph.id}`}
                    className="block truncate font-bold hover:underline"
                  >
                    {graph.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    Atualizado em {formatDateTime(graph.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/graphs/${graph.id}`} aria-label={`Abrir ${graph.name}`}>
                      Abrir
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    title="Excluir projeto"
                    aria-label={`Excluir ${graph.name}`}
                    className="text-muted-foreground hover:border-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:border-destructive focus-visible:text-destructive"
                    onClick={() => {
                      remove.reset();
                      setToDelete(graph);
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Excluir projeto?"
          description={`“${toDelete.name}” será excluído deste computador. Essa ação não pode ser desfeita.`}
          confirmLabel="Excluir"
          pendingLabel="Excluindo…"
          pending={remove.isPending}
          error={remove.isError ? deleteErrorMessage(remove.error) : null}
          onCancel={() => setToDelete(null)}
          onConfirm={() => remove.mutate(toDelete.id, { onSuccess: () => setToDelete(null) })}
        />
      )}
    </div>
  );
}
