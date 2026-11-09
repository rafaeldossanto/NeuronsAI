import type { GraphDefinition } from "@neurons/graph-schema";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { EdgePulse } from "@/runs/live/pulse-edges";
import { annotationNodeTypes, type AnnotationNode } from "./annotation-nodes";
import { annotationShell, linkFlowEdges } from "./flow-model";
import { GRID } from "./model";
import { nodeTypes, type BlockLive, type BlockNode } from "./nodes";
import { edgeTypes, type PulseEdgeData } from "./pulse-edge";

type ViewerNode = BlockNode | AnnotationNode;
const allNodeTypes = { ...nodeTypes, ...annotationNodeTypes };
const noop = () => undefined;
const NO_HANDLERS = { onResizeStart: noop, onResize: noop, onResizeEnd: noop };

export interface GraphViewerProps {
  doc: Pick<GraphDefinition, "nodes" | "links" | "annotations">;
  /** What each agent block shows, by node id. */
  live: Readonly<Record<string, BlockLive>>;
  /** The pulses to draw, by arrow id (see `pulsesByEdge`). */
  pulses: Readonly<Record<string, EdgePulse[]>>;
  selectedId: string | null;
  onSelect: (nodeId: string | null) => void;
}

/**
 * The graph as a read-only canvas: the blocks and arrows of the editor (same components, same
 * layout), with no dragging, connecting, deleting or drawing. Clicking a block selects it.
 */
export function GraphViewer(props: GraphViewerProps) {
  return (
    <ReactFlowProvider>
      <Viewer {...props} />
    </ReactFlowProvider>
  );
}

function Viewer({ doc, live, pulses, selectedId, onSelect }: GraphViewerProps) {
  const nodes = useMemo<ViewerNode[]>(() => {
    const drawings: AnnotationNode[] = doc.annotations.map((annotation) => ({
      ...annotationShell(annotation, false),
      selectable: false,
      draggable: false,
      data: { annotation, ...NO_HANDLERS },
    }));
    const blocks: ViewerNode[] = doc.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      selected: node.id === selectedId,
      data: { node, issues: [], live: live[node.id] },
    }));
    return [...drawings, ...blocks];
  }, [doc.nodes, doc.annotations, live, selectedId]);

  const base = useMemo(
    () => linkFlowEdges({ nodes: doc.nodes, links: doc.links }),
    [doc.nodes, doc.links],
  );
  const edges = useMemo<Edge[]>(
    () =>
      base.map((edge) => ({
        ...edge,
        type: "pulse",
        data: { pulses: pulses[edge.id] ?? [] } satisfies PulseEdgeData,
      })),
    [base, pulses],
  );

  return (
    <div className="size-full" role="region" aria-label="Canvas da execução">
      <ReactFlow<ViewerNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={allNodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable
        // The canvas sits inside a page that scrolls: the wheel scrolls the page; zoom with the buttons or Ctrl+wheel.
        zoomOnScroll={false}
        preventScrolling={false}
        deleteKeyCode={null}
        onNodeClick={(_, node) => {
          if (node.type === "agent") onSelect(node.id === selectedId ? null : node.id);
        }}
        onPaneClick={() => onSelect(null)}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID} size={1.5} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
