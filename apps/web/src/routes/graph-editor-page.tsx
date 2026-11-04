import { Link, useParams } from "react-router";
import { EmptyState, ErrorState, LoadingRows } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GraphEditor } from "@/editor/graph-editor";
import { formatDateTime } from "@/lib/format";
import { useGraph, useGraphVersions } from "@/lib/queries";

export function GraphEditorPage() {
  const { id = "" } = useParams();
  const graph = useGraph(id);
  const versions = useGraphVersions(id);

  if (graph.isPending) return <LoadingRows label="Carregando grafo" rows={4} />;
  if (graph.isError) return <ErrorState error={graph.error} onRetry={() => void graph.refetch()} />;

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

      <GraphEditor key={graph.data.id} graph={graph.data} />

      <div>
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
