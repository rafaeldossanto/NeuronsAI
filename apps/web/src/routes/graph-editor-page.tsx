import { Link, useParams } from "react-router";
import { EmptyState, ErrorState, LoadingRows } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { useGraph, useGraphVersions } from "@/lib/queries";

/** Counts what a (possibly incomplete) draft holds; the draft is `unknown` until it is published. */
function draftCounts(draft: unknown) {
  const record =
    typeof draft === "object" && draft !== null ? (draft as Record<string, unknown>) : null;
  const nodes = Array.isArray(record?.["nodes"]) ? record["nodes"].length : 0;
  const links = Array.isArray(record?.["links"]) ? record["links"].length : 0;
  return { hasDraft: record !== null, nodes, links };
}

export function GraphEditorPage() {
  const { id = "" } = useParams();
  const graph = useGraph(id);
  const versions = useGraphVersions(id);

  if (graph.isPending) return <LoadingRows label="Carregando grafo" rows={4} />;
  if (graph.isError) return <ErrorState error={graph.error} onRetry={() => void graph.refetch()} />;

  const counts = draftCounts(graph.data.draft);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          to="/graphs"
          className="text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          ← Grafos
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{graph.data.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Criado em {formatDateTime(graph.data.createdAt)} · atualizado em{" "}
          {formatDateTime(graph.data.updatedAt)}
        </p>
      </div>

      <section
        aria-label="Área do canvas"
        className="flex min-h-72 items-center justify-center rounded-lg border border-dashed bg-card p-8 text-center"
      >
        <div>
          <p className="font-bold">O canvas do grafo aparece aqui</p>
          <p className="mt-1 text-sm text-muted-foreground">
            O editor visual chega na próxima etapa (T12).
          </p>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Rascunho</CardTitle>
          </CardHeader>
          <CardContent>
            {counts.hasDraft ? (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Blocos</dt>
                <dd className="font-semibold">{counts.nodes}</dd>
                <dt className="text-muted-foreground">Setas</dt>
                <dd className="font-semibold">{counts.links}</dd>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Ainda não há rascunho salvo.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Versões publicadas</CardTitle>
          </CardHeader>
          <CardContent>
            {versions.isPending && <LoadingRows rows={2} label="Carregando versões" />}
            {versions.isError && (
              <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
            )}
            {versions.isSuccess && versions.data.length === 0 && (
              <EmptyState title="Nenhuma versão publicada" />
            )}
            {versions.isSuccess && versions.data.length > 0 && (
              <ul className="flex flex-col gap-2 text-sm">
                {versions.data.map((version) => (
                  <li key={version.id} className="flex justify-between">
                    <span className="font-semibold">v{version.version}</span>
                    <span className="text-muted-foreground">
                      {formatDateTime(version.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
