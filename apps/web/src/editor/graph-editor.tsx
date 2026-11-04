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
  Circle,
  Cloud,
  Frame,
  MousePointer2,
  Network,
  Play,
  MoveUpRight,
  Redo2,
  Save,
  Square,
  SquareTerminal,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Upload,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { Field, Select, TextArea } from "./fields";
import { useApi, unwrap } from "@/lib/api";
import { useNavigate } from "react-router";
import { usePublishVersion, useSaveDraft } from "@/lib/queries";
import { annotationNodeType, annotationNodeTypes, type AnnotationNode } from "./annotation-nodes";
import { createAnnotation, INK, TOOLS, type AnnotationKind, type Tool } from "./annotations";
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

type CanvasNode = BlockNode | AnnotationNode;
const allNodeTypes = { ...nodeTypes, ...annotationNodeTypes };

const TOOL_ICONS: Record<Tool, LucideIcon> = {
  select: MousePointer2,
  rect: Square,
  ellipse: Circle,
  arrow: MoveUpRight,
  text: Type,
  note: StickyNote,
  group: Frame,
};

/** Keys typed in a field are text, not shortcuts. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

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
  const api = useApi();
  const navigate = useNavigate();
  const [runOpen, setRunOpen] = useState(false);
  const [runInput, setRunInput] = useState("");
  const [runTrigger, setRunTrigger] = useState("");
  const [executing, setExecuting] = useState(false);
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
  const [tool, setTool] = useState<Tool>("select");
  const [draft, setDraft] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const { setCenter, getZoom, screenToFlowPosition } = useReactFlow();

  const save = useSaveDraft(graph.id);
  const publish = usePublishVersion(graph.id);
  const busy = save.isPending || publish.isPending || executing;

  const issues = useMemo(() => validateDoc(doc), [doc]);
  const dirty = serialize(doc) !== savedJson;

  // React Flow's nodes and edges are derived from the document; only the sizes it measures are kept.
  const rfNodes = useMemo<CanvasNode[]>(() => {
    const issuesByNode = new Map<string, string[]>();
    for (const issue of issues) {
      if (issue.targetNodeId)
        issuesByNode.set(issue.targetNodeId, [
          ...(issuesByNode.get(issue.targetNodeId) ?? []),
          issue.message,
        ]);
    }
    const blocks: CanvasNode[] = doc.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      selected: selected.nodes.includes(node.id),
      data: { node, issues: issuesByNode.get(node.id) ?? [] },
      ...(measured[node.id] ? { measured: measured[node.id] } : {}),
    }));
    // The free layer sits under blocks and arrows (groups under the other annotations).
    const drawings: CanvasNode[] = doc.annotations.map((annotation) => ({
      id: annotation.id,
      type: annotationNodeType(annotation.kind),
      position: annotation.position,
      selected: selected.nodes.includes(annotation.id),
      zIndex: annotation.kind === "group" ? -2 : -1,
      ...(annotation.kind === "group" || annotation.kind === "arrow"
        ? { style: { pointerEvents: "none" as const } }
        : {}),
      data: {
        annotation,
        onResizeStart: () => {
          resizing.current = true;
        },
        onResize: (id, position, size) =>
          dispatch({ type: "resizeAnnotation", id, position, size, gesture: "resize" }),
        onResizeEnd: () => {
          resizing.current = false;
          dispatch({ type: "endGesture" });
        },
      },
    }));
    return [...drawings, ...blocks];
  }, [doc.nodes, doc.annotations, issues, selected.nodes, measured]);

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

  // ---------- tool shortcuts (V, R, O, A, T, N, G; Esc goes back to selecting) ----------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      if (event.key === "Escape") return setTool("select");
      const match = TOOLS.find((entry) => entry.key === event.key.toLowerCase());
      if (match) setTool(match.tool);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ---------- canvas events ----------
  const annotationIds = useMemo(
    () => new Set(doc.annotations.map((annotation) => annotation.id)),
    [doc.annotations],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const positions: Record<string, { x: number; y: number }> = {};
      let dragEnded = false;
      const sizes: Record<string, { width: number; height: number }> = {};
      for (const change of changes) {
        // Annotations are sized and resized by their own components (see `rfNodes`).
        const isDrawing = change.type !== "add" && annotationIds.has(change.id);
        if (change.type === "dimensions" && change.dimensions && !isDrawing)
          sizes[change.id] = change.dimensions;
        if (change.type === "position" && !(isDrawing && resizing.current)) {
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
    },
    [annotationIds],
  );

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

  const removeItems = useCallback(
    (ids: string[], edgeIds: string[]) => {
      const triggerEdges = edgeIds.filter((id) => id.startsWith(TRIGGER_EDGE));
      dispatch({
        type: "remove",
        nodeIds: ids.filter((id) => !annotationIds.has(id)),
        annotationIds: ids.filter((id) => annotationIds.has(id)),
        linkIds: edgeIds.filter((id) => !id.startsWith(TRIGGER_EDGE)),
        clearTargets: triggerEdges.map((id) => id.slice(TRIGGER_EDGE.length)),
      });
      setSelected({ nodes: [], links: [] });
    },
    [annotationIds],
  );

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
  const addNode = (kind: NewNodeKind, position = nextPosition(doc)) => {
    const id = crypto.randomUUID();
    dispatch({ type: "addNode", node: defaultNode(kind, id, position, doc) });
    setSelected({ nodes: [id], links: [] });
  };

  // ---------- drawing the free layer ----------
  const startDrawing = (event: ReactMouseEvent) => {
    if (event.button !== 0 || tool === "select") return;
    event.preventDefault();
    const kind: AnnotationKind = tool;
    const start = { x: event.clientX, y: event.clientY };
    const area = overlayRef.current?.getBoundingClientRect();
    const local = (x: number, y: number) => ({ x: x - (area?.left ?? 0), y: y - (area?.top ?? 0) });
    setDraft({ from: local(start.x, start.y), to: local(start.x, start.y) });
    const move = (e: MouseEvent) =>
      setDraft({ from: local(start.x, start.y), to: local(e.clientX, e.clientY) });
    const up = (e: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDraft(null);
      const at = (x: number, y: number) => {
        const point = screenToFlowPosition({ x, y });
        return { x: Math.round(point.x), y: Math.round(point.y) };
      };
      const id = crypto.randomUUID();
      dispatch({
        type: "addAnnotation",
        annotation: createAnnotation(
          kind,
          id,
          at(start.x, start.y),
          at(e.clientX, e.clientY),
          doc,
          measured,
        ),
      });
      setSelected({ nodes: [id], links: [] });
      setTool("select");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
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

  const onRun = async () => {
    setExecuting(true);
    try {
      if (dirty) await persist();
      const version = await publish.mutateAsync();
      const run = await unwrap(
        api.POST("/runs", {
          body: {
            graphVersionId: version.id,
            input: runInput,
            ...(runTrigger && { triggerId: runTrigger }),
          },
        }),
      );
      await navigate(`/runs/${run.id}`);
    } catch (error) {
      setRunOpen(false);
      setNotice({ kind: "error", text: messageOf(error) });
    } finally {
      setExecuting(false);
    }
  };

  const inspectorSelection = {
    nodeIds: selected.nodes.filter((id) => doc.nodes.some((n) => n.id === id)),
    linkIds: selected.links.filter((id) => doc.links.some((l) => l.id === id)),
    annotationIds: selected.nodes.filter((id) => annotationIds.has(id)),
  };
  const hasSelection = selected.nodes.length + selected.links.length > 0;

  return (
    <div className="modeler-editor flex min-h-0 flex-1 flex-col gap-3">
      <div
        role="toolbar"
        aria-label="Ferramentas do editor"
        className="flex flex-wrap items-center gap-2"
      >
        <div role="group" aria-label="Camada livre" className="flex items-center gap-1">
          {TOOLS.map(({ tool: entry, label, key }) => {
            const Icon = TOOL_ICONS[entry];
            return (
              <Button
                key={entry}
                variant={tool === entry ? "accent" : "outline"}
                size="sm"
                aria-label={label}
                aria-pressed={tool === entry}
                title={`${label} (${key.toUpperCase()})`}
                onClick={() => setTool(entry)}
              >
                <Icon className="size-4" />
              </Button>
            );
          })}
        </div>
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
          <Button
            size="sm"
            onClick={() => {
              setRunTrigger(doc.nodes.find((node) => node.type === "trigger")?.id ?? "");
              setRunOpen(true);
            }}
            disabled={busy || issues.length > 0}
            title={
              issues.length > 0
                ? "Corrija os problemas antes de executar."
                : "Salvar uma versão e iniciar a execução"
            }
          >
            <Play className="size-4" /> Executar
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

      <div className="modeler-workspace flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-background">
        <aside className="element-library" aria-label="Elementos">
          <h2 className="mb-6 text-sm font-semibold">Elementos</h2>
          <h3>Agentes</h3>
          <ToolButton
            label="Agente de API"
            kind="agent-api"
            onClick={() => addNode("agent-api")}
            icon={<Cloud />}
          />
          <ToolButton
            label="Agente de terminal"
            kind="agent-terminal"
            onClick={() => addNode("agent-terminal")}
            icon={<SquareTerminal />}
          />
          <h3>Gatilhos</h3>
          <ToolButton
            label="Gatilho"
            kind="trigger"
            onClick={() => addNode("trigger")}
            icon={<Zap />}
          />
          <h3>Ferramentas</h3>
          <ToolButton
            label="Memória"
            kind="tool"
            onClick={() => addNode("tool")}
            icon={<Network />}
          />
          <ToolButton label="Ferramenta" onClick={() => addNode("tool")} icon={<Wrench />} />
          <h3>Anotações</h3>
          {TOOLS.filter((entry) => entry.tool !== "select").map(({ tool: entry, label }) => {
            const Icon = TOOL_ICONS[entry];
            return (
              <ToolButton
                key={entry}
                label={`Desenhar ${label.toLowerCase()}`}
                icon={<Icon />}
                onClick={() => setTool(entry)}
              />
            );
          })}
        </aside>
        <div
          className="relative min-w-0 flex-1"
          aria-label="Canvas do grafo"
          role="region"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const kind = event.dataTransfer.getData("application/neurons-node");
            if (!["agent-api", "agent-terminal", "trigger", "tool"].includes(kind)) return;
            addNode(
              kind as NewNodeKind,
              screenToFlowPosition({ x: event.clientX, y: event.clientY }),
            );
          }}
        >
          <ReactFlow<CanvasNode>
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={allNodeTypes}
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
            elevateNodesOnSelect={false}
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
          {doc.nodes.length === 0 && doc.annotations.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="max-w-xs p-4 text-center">
                <Network className="mx-auto mb-4 size-10 text-muted-foreground" />
                <h2 className="text-lg font-semibold">Crie seu primeiro fluxo</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Adicione um agente pela lateral e conecte suas ferramentas e memórias.
                </p>
              </div>
            </div>
          )}
          {tool !== "select" && (
            <div
              ref={overlayRef}
              role="presentation"
              data-testid="draw-overlay"
              className="absolute inset-0 z-10 cursor-crosshair"
              onMouseDown={startDrawing}
            >
              {draft && <DraftShape draft={draft} tool={tool} />}
            </div>
          )}
        </div>
        <Inspector doc={doc} selection={inspectorSelection} issues={issues} dispatch={dispatch} />
      </div>

      <IssuesPanel issues={issues} doc={doc} onSelect={focusIssue} />
      {runOpen && (
        <Modal
          title="Executar projeto"
          onClose={() => {
            if (!executing) setRunOpen(false);
          }}
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void onRun();
            }}
          >
            <p className="text-sm text-muted-foreground">
              O projeto será salvo como uma nova versão antes de executar. O uso será contabilizado
              nas contas e chaves escolhidas para os agentes.
            </p>
            <Field label="Gatilho inicial">
              <Select value={runTrigger} onChange={(event) => setRunTrigger(event.target.value)}>
                {doc.nodes
                  .filter((node) => node.type === "trigger")
                  .map((node) => (
                    <option value={node.id} key={node.id}>
                      {node.id}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Pedido para os agentes">
              <TextArea
                required
                maxLength={100000}
                value={runInput}
                onChange={(event) => setRunInput(event.target.value)}
                placeholder="Descreva o que este time deve fazer"
              />
            </Field>
            <Button type="submit" disabled={executing || !runInput.trim()}>
              {executing ? "Iniciando…" : "Iniciar execução"}
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}

/** The dashed preview of what the drag in progress will draw (in coordinates relative to the drawing area). */
function DraftShape({
  draft,
  tool,
}: {
  draft: { from: { x: number; y: number }; to: { x: number; y: number } };
  tool: Tool;
}) {
  const { x: x1, y: y1 } = draft.from;
  const { x: x2, y: y2 } = draft.to;
  const props = { stroke: INK.ambar, strokeWidth: 2, strokeDasharray: "6 4", fill: "none" };
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
      {tool === "arrow" ? (
        <line x1={x1} y1={y1} x2={x2} y2={y2} {...props} />
      ) : tool === "ellipse" ? (
        <ellipse
          cx={(x1 + x2) / 2}
          cy={(y1 + y2) / 2}
          rx={Math.abs(x2 - x1) / 2}
          ry={Math.abs(y2 - y1) / 2}
          {...props}
        />
      ) : (
        <rect
          x={Math.min(x1, x2)}
          y={Math.min(y1, y2)}
          width={Math.abs(x2 - x1)}
          height={Math.abs(y2 - y1)}
          {...props}
        />
      )}
    </svg>
  );
}

function ToolButton({
  label,
  icon,
  onClick,
  kind,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  kind?: NewNodeKind;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className="[&_svg]:size-4"
      draggable={Boolean(kind)}
      onDragStart={(event) => {
        if (kind) event.dataTransfer.setData("application/neurons-node", kind);
      }}
    >
      {icon}
      {label}
    </Button>
  );
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Algo deu errado.";
}
