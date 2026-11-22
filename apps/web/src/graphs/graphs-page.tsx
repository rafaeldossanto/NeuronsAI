import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { EmptyState, ErrorState, LoadingRows } from "@/shared/states";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ProjectCard } from "@/graphs/project-card";
import { useCreateGraph, useGraphs } from "@/graphs/queries";

export function GraphsPage() {
  const graphs = useGraphs();
  const create = useCreateGraph();
  const [name, setName] = useState("");

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
              <ProjectCard graph={graph} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
