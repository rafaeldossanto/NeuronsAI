import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { EmptyState, ErrorState, LoadingRows } from "@/shared/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { canRunGraph } from "@/graphs/access/levels";
import { useSession } from "@/accounts/auth/session-context";
import { GraphAccessButton, managesAccess } from "@/graphs/access/access-controls";
import { useGraphVersion } from "@/graphs/access/queries";
import { UseOnlyProject } from "@/graphs/access/use-only-project";
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
  const { account } = useSession();

  if (graph.isPending) return <LoadingRows label="Carregando projeto" rows={4} />;
  if (graph.isError) return <ErrorState error={graph.error} onRetry={() => void graph.refetch()} />;

  const usesOnly = graph.data.access.level === "use";

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
          {account !== null && managesAccess(graph.data) && (
            <GraphAccessButton project={graph.data} />
          )}
        </div>
      )}

      {usesOnly ? (
        // Whoever only uses a project never gets the draft: the published version, read-only.
        chats ? (
          <PublishedChats key={id} graph={graph.data} agentId={agentId} />
        ) : (
          <UseOnlyProject key={graph.data.id} graph={graph.data} />
        )
      ) : (
        <>
          <GraphEditor
            key={`editor-${graph.data.id}`}
            graph={graph.data}
            active={!chats}
            focusNodeId={nodeId}
            agentChatHref={(agentNodeId) => chatPath(id, agentNodeId)}
          />
          {chats && doc && (
            <ProjectChats
              key={id}
              graphId={id}
              doc={doc}
              agentId={agentId}
              canSend={canRunGraph(graph.data.access.level)}
            />
          )}
        </>
      )}
      {!chats && <ProjectVersions id={id} />}
    </div>
  );
}

/** The chats of a person who only uses the project: they talk to the published version. */
function PublishedChats({
  graph,
  agentId,
}: {
  graph: { id: string; latestVersion: number | null };
  agentId: string | undefined;
}) {
  const version = useGraphVersion(graph.id, graph.latestVersion);
  if (graph.latestVersion === null) {
    return (
      <EmptyState
        title="Este projeto ainda não tem versão publicada"
        hint="Peça a quem edita o projeto para publicar uma versão; depois você poderá conversar com os agentes."
      />
    );
  }
  if (version.isPending) return <LoadingRows label="Carregando agentes" rows={3} />;
  if (version.isError)
    return <ErrorState error={version.error} onRetry={() => void version.refetch()} />;
  return <ProjectChats graphId={graph.id} doc={version.data.definition} agentId={agentId} />;
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
