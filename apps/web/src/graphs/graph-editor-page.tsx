import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { EmptyState, ErrorState, LoadingRows } from "@/shared/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ProjectChats } from "@/graphs/chats/project-chats";
import { GraphEditor } from "@/graphs/editor/graph-editor";
import { createDoc } from "@/graphs/editor/model";
import { chatPath, ProjectNavigation } from "@/graphs/project-navigation";
import { formatDateTime } from "@/shared/format";
import { useGraph, useGraphVersions } from "@/graphs/queries";

export function GraphEditorPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const graph = useGraph(id);
  const doc = useMemo(() => (graph.data ? createDoc(graph.data) : null), [graph.data]);
  const chats = params.get("view") === "chats";
  const agentId = params.get("agent") ?? undefined;
  const nodeId = params.get("node") ?? undefined;

  if (graph.isPending) return <LoadingRows label="Carregando projeto" rows={4} />;
  if (graph.isError) return <ErrorState error={graph.error} onRetry={() => void graph.refetch()} />;

  return (
    <div
      className={chats ? "project-editor-page project-editor-page-chats" : "project-editor-page"}
    >
      {!chats && (
        <div className="project-heading">
          <Link
            to="/graphs"
            className="text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            ← Meus projetos
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">{graph.data.name}</h1>
          <ProjectNavigation graphId={id} chats={false} agentId={nodeId} />
          <p className="ml-auto text-xs text-muted-foreground">
            Criado em {formatDateTime(graph.data.createdAt)} · atualizado em{" "}
            {formatDateTime(graph.data.updatedAt)}
          </p>
        </div>
      )}

      <GraphEditor
        key={`editor-${graph.data.id}`}
        graph={graph.data}
        active={!chats}
        focusNodeId={nodeId}
        agentChatHref={(agentNodeId) => chatPath(id, agentNodeId)}
      />
      {chats ? (
        doc && <ProjectChats key={id} graphId={id} doc={doc} agentId={agentId} />
      ) : (
        <ProjectVersions id={id} />
      )}
    </div>
  );
}

function ProjectVersions({ id }: { id: string }) {
  const versions = useGraphVersions(id);
  return (
    <details className="project-versions">
      <summary>Versões e histórico do projeto</summary>
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
    </details>
  );
}
