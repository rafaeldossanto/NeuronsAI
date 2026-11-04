import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Cloud,
  Redo2,
  Save,
  SquareTerminal,
  Trash2,
  Undo2,
  Upload,
  Wrench,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { usePublishVersion, useSaveDraft } from "@/lib/queries";
import { Inspector } from "./inspector";
import { validateDoc, type LocatedIssue } from "./issues";
import {
  connectionAction,
  createDoc,
  createEditorState,
  defaultNode,
  editorReducer,
  GRID,
  nextPosition,
  serialize,
  type NewNodeKind,
} from "./model";
import { nodeTypes, type BlockNode } from "./nodes";
import { IssuesPanel } from "./issues-panel";

const TRIGGER_EDGE = "trigger:";

interface EditorGraph {
  id: string;
  name: string;
  draft: unknown;
}

export function GraphEditor({ graph }: { graph: EditorGraph }) {
  return (
    <ReactFlowProvider>
      <Editor graph={graph} />
    </ReactFlowProvider>
  );
}

function edgeColor(invalid: boolean) {
  return invalid ? "var(--destructive)" : "var(--foreground)";
}

function Editor({ graph }: { graph: EditorGraph }) {
  const [state, dispatch] = useReducer(editorReducer, graph, (g) =>
    createEditorState(createDoc(g)),
  );
  const doc = state.present;
  const [savedJson, setSavedJson] = useState(() => serialize(state.present));
  const [selected, setSelected] = useState<{ nodes: string[]; links: string[] }>({
    nodes: [],
    links: [],
  });
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const { setCenter, getZoom } = useReactFlow();

  const save = useSaveDraft(graph.id);
  const publish = usePublishVersion(graph.id);
  const busy = save.isPending || publish.isPending;

  const issues = useMemo(() => validateDoc(doc), [doc]);
  const dirty = serialize(doc) !== savedJson;

  // React Flow's nodes and edges are derived from the document; only the sizes it measures are kept.
  const rfNodes = useMemo<BlockNode[]>(() => {
    const issuesByNode = new Map<string, string[]>();
    for (const issue of issues) {
      if (issue.targetNodeId)
        issuesByNode.set(issue.targetNodeId, [
          ...(issuesByNode.get(issue.targetNodeId) ?? []),
          issue.message,
        ]);
    }
    return doc.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      selected: selected.nodes.includes(node.id),
      data: { node, issues: issuesByNode.get(node.id) ?? [] },
      ...(measured[node.id] ? { measured: measured[node.id] } : {}),
    }));
  }, [doc.nodes, issues, selected.nodes, measured]);

  const rfEdges = useMemo<Edge[]>(() => {
    const invalidLinks = new Set(issues.flatMap((issue) => issue.targetLinkId ?? []));
    const nodeIds = new Set(doc.nodes.map((node) => node.id));
    const linkEdges: Edge[] = doc.links.map((link) => {
      const color = edgeColor(invalidLinks.has(link.id));
      return {
        id: link.id,
        source: link.from,
        target: link.to,
        selected: selected.links.includes(link.id),
        markerEnd: { type: MarkerType.ArrowClosed, color },
        ...(link.bidirectional ? { markerStart: { type: MarkerType.ArrowClosed, color } } : {}),
        style: {
          stroke: color,
          strokeWidth: 1.75,
          ...(link.kind === "uses" ? { strokeDasharray: "6 4" } : {}),
        },
      };
    });
    // A trigger's arrow is its `target` field, not a link.
    const triggerEdges: Edge[] = doc.nodes.flatMap((node) => {
      if (node.type !== "trigger" || !nodeIds.has(node.target)) return [];
      const id = `${TRIGGER_EDGE}${node.id}`;
      return [
        {
          id,
          source: node.id,
          target: node.target,
          selected: selected.links.includes(id),
          markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(false) },
          style: { stroke: edgeColor(false), strokeWidth: 1.75 },
        },
      ];
    });
    return [...linkEdges, ...triggerEdges];
  }, [doc.nodes, doc.links, issues, selected.links]);

  // ---------- history shortcuts ----------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) dispatch({ type: "undo" });
      else if ((key === "z" && event.shiftKey) || key === "y") dispatch({ type: "redo" });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ---------- canvas events ----------
  const onNodesChange = useCallback((changes: NodeChange<BlockNode>[]) => {
    const positions: Record<string, { x: number; y: number }> = {};
    let dragEnded = false;
    const sizes: Record<string, { width: number; height: number }> = {};
    for (const change of changes) {
      if (change.type === "dimensions" && change.dimensions) sizes[change.id] = change.dimensions;
      if (change.type === "position") {
        if (change.position) positions[change.id] = change.position;
        if (change.dragging === false) dragEnded = true;
      }
    }
    if (Object.keys(sizes).length > 0) setMeasured((current) => ({ ...current, ...sizes }));
    if (Object.keys(positions).length > 0)
      dispatch({ type: "moveNodes", positions, gesture: "drag" });
    if (dragEnded) dispatch({ type: "endGesture" });
    const picks = changes.filter((change) => change.type === "select");
    if (picks.length > 0) {
      setSelected((current) => {
        const nodes = new Set(current.nodes);
        for (const pick of picks) {
          if (pick.selected) nodes.add(pick.id);
          else nodes.delete(pick.id);
        }
        return { ...current, nodes: [...nodes] };
      });
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const picks = changes.filter((change) => change.type === "select");
    if (picks.length > 0) {
      setSelected((current) => {
        const links = new Set(current.links);
        for (const pick of picks) {
          if (pick.selected) links.add(pick.id);
          else links.delete(pick.id);
        }
        return { ...current, links: [...links] };
      });
    }
  }, []);

  const removeItems = useCallback((nodeIds: string[], edgeIds: string[]) => {
    const triggerEdges = edgeIds.filter((id) => id.startsWith(TRIGGER_EDGE));
    dispatch({
      type: "remove",
      nodeIds,
      linkIds: edgeIds.filter((id) => !id.startsWith(TRIGGER_EDGE)),
      clearTargets: triggerEdges.map((id) => id.slice(TRIGGER_EDGE.length)),
    });
    setSelected({ nodes: [], links: [] });
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      const action = connectionAction(
        doc,
        connection.source,
        connection.target,
        crypto.randomUUID(),
      );
      if (action) {
        dispatch(action);
        setNotice(null);
      } else {
        setNotice({
          kind: "error",
          text: "Essa ligação não é permitida: agentes conversam entre si, usam ferramentas e são iniciados por gatilhos.",
        });
      }
    },
    [doc],
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) =>
      connectionAction(doc, connection.source, connection.target, "check") !== null,
    [doc],
  );

  // ---------- toolbar ----------
  const addNode = (kind: NewNodeKind) => {
    const id = crypto.randomUUID();
    dispatch({ type: "addNode", node: defaultNode(kind, id, nextPosition(doc), doc) });
    setSelected({ nodes: [id], links: [] });
  };

  const focusIssue = (issue: LocatedIssue) => {
    if (issue.targetNodeId) {
      const node = doc.nodes.find((n) => n.id === issue.targetNodeId);
      setSelected({ nodes: [issue.targetNodeId], links: [] });
      if (node) void setCenter(node.position.x + 104, node.position.y + 30, { zoom: getZoom() });
    } else if (issue.targetLinkId) {
      setSelected({ nodes: [], links: [issue.targetLinkId] });
      const link = doc.links.find((l) => l.id === issue.targetLinkId);
      const ends = doc.nodes.filter((n) => n.id === link?.from || n.id === link?.to);
      if (ends.length > 0) {
        const x = ends.reduce((sum, n) => sum + n.position.x, 0) / ends.length + 104;
        const y = ends.reduce((sum, n) => sum + n.position.y, 0) / ends.length + 30;
        void setCenter(x, y, { zoom: getZoom() });
      }
    }
  };

  const persist = async () => {
    const snapshot = doc;
    await save.mutateAsync({
      draft: snapshot,
      ...(snapshot.name !== graph.name ? { name: snapshot.name } : {}),
    });
    setSavedJson(serialize(snapshot));
    return snapshot;
  };

  const onSave = async () => {
    try {
      await persist();
      setNotice({ kind: "ok", text: "Rascunho salvo." });
    } catch (error) {
      setNotice({ kind: "error", text: messageOf(error) });
    }
  };

  const onPublish = async () => {
    try {
      if (dirty) await persist();
      const version = await publish.mutateAsync();
      setNotice({ kind: "ok", text: `Versão ${version.version} publicada.` });
    } catch (error) {
      setNotice({ kind: "error", text: messageOf(error) });
    }
  };

  const inspectorSelection = {
    nodeIds: selected.nodes.filter((id) => doc.nodes.some((n) => n.id === id)),
    linkIds: selected.links.filter((id) => doc.links.some((l) => l.id === id)),
  };
  const hasSelection = selected.nodes.length + selected.links.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div
        role="toolbar"
        aria-label="Ferramentas do editor"
        className="flex flex-wrap items-center gap-2"
      >
        <ToolButton label="Agente de API" onClick={() => addNode("agent-api")} icon={<Cloud />} />
        <ToolButton
          label="Agente de terminal"
          onClick={() => addNode("agent-terminal")}
          icon={<SquareTerminal />}
        />
        <ToolButton label="Ferramenta" onClick={() => addNode("tool")} icon={<Wrench />} />
        <ToolButton label="Gatilho" onClick={() => addNode("trigger")} icon={<Zap />} />
        <span aria-hidden className="mx-1 h-6 w-px bg-border" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => dispatch({ type: "undo" })}
          disabled={state.past.length === 0}
          aria-label="Desfazer"
          title="Desfazer (Ctrl+Z)"
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => dispatch({ type: "redo" })}
          disabled={state.future.length === 0}
          aria-label="Refazer"
          title="Refazer (Ctrl+Shift+Z)"
        >
          <Redo2 className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => removeItems(selected.nodes, selected.links)}
          disabled={!hasSelection}
          aria-label="Apagar seleção"
          title="Apagar seleção (Delete)"
        >
          <Trash2 className="size-4" />
        </Button>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs font-semibold text-muted-foreground" role="status">
            {dirty ? "Alterações não salvas" : "Tudo salvo"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onSave()}
            disabled={busy || !dirty}
          >
            <Save className="size-4" /> Salvar rascunho
          </Button>
          <Button
            variant="accent"
            size="sm"
            onClick={() => void onPublish()}
            disabled={busy || issues.length > 0}
            title={issues.length > 0 ? "Corrija os problemas antes de publicar." : undefined}
          >
            <Upload className="size-4" /> Publicar versão
          </Button>
        </div>
      </div>

      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={
            notice.kind === "error"
              ? "text-sm font-semibold text-destructive"
              : "text-sm font-semibold text-muted-foreground"
          }
        >
          {notice.text}
        </p>
      )}

      <div className="flex h-[640px] overflow-hidden rounded-lg border bg-background">
        <div className="min-w-0 flex-1" aria-label="Canvas do grafo" role="region">
          <ReactFlow<BlockNode>
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onDelete={({ nodes, edges }) =>
              removeItems(
                nodes.map((n) => n.id),
                edges.map((e) => e.id),
              )
            }
            onPaneClick={() => setSelected({ nodes: [], links: [] })}
            deleteKeyCode="Delete"
            snapToGrid
            snapGrid={[GRID, GRID]}
            selectionOnDrag
            panOnDrag={[1, 2]}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            minZoom={0.2}
            maxZoom={2}
          >
            <Background variant={BackgroundVariant.Dots} gap={GRID} size={1.5} />
            <MiniMap pannable zoomable ariaLabel="Minimapa" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <Inspector doc={doc} selection={inspectorSelection} issues={issues} dispatch={dispatch} />
      </div>

      <IssuesPanel issues={issues} doc={doc} onSelect={focusIssue} />
    </div>
  );
}

function ToolButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} className="[&_svg]:size-4">
      {icon}
      {label}
    </Button>
  );
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Algo deu errado.";
}
