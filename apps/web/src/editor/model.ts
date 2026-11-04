import type {
  AgentRuntime,
  GraphDefinition,
  GraphNode,
  Link,
  Position,
} from "@neurons/graph-schema";

/**
 * The editor's state is the graph document itself, kept as plain JSON. Every edit is a shallow
 * copy-on-write of the parts it touches, so fields the canvas does not edit (`annotations[]`,
 * unknown keys inside blocks and links) are carried through untouched and saved back as they were.
 */
export type GraphDoc = GraphDefinition;
export type FieldPath = readonly (string | number)[];

export const HISTORY_LIMIT = 100;
export const GRID = 20;

export type EditorAction =
  | { type: "addNode"; node: GraphNode }
  | { type: "moveNodes"; positions: Record<string, Position>; gesture?: string }
  /** Sets (or, with `undefined`, removes) the value at `path` inside a block. */
  | { type: "setNodeField"; id: string; path: FieldPath; value: unknown }
  | { type: "addLink"; link: Link }
  | { type: "setLinkField"; id: string; path: FieldPath; value: unknown }
  /** Deletes blocks (with their links) and links; `clearTargets` are triggers whose arrow is deleted. */
  | { type: "remove"; nodeIds?: string[]; linkIds?: string[]; clearTargets?: string[] }
  | { type: "rename"; name: string }
  | { type: "endGesture" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "load"; doc: GraphDoc };

export interface EditorState {
  past: GraphDoc[];
  present: GraphDoc;
  future: GraphDoc[];
  /** Key of the edit in progress (typing in one field, dragging): further edits with it merge into one step. */
  gesture: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Builds the editing document from a stored draft (which may be missing or incomplete). */
export function createDoc(graph: { id: string; name: string; draft: unknown }): GraphDoc {
  const draft = isRecord(graph.draft) ? graph.draft : {};
  return {
    ...draft,
    schemaVersion: 1,
    id: typeof draft["id"] === "string" ? draft["id"] : graph.id,
    name: typeof draft["name"] === "string" && draft["name"] !== "" ? draft["name"] : graph.name,
    nodes: Array.isArray(draft["nodes"]) ? (draft["nodes"] as GraphNode[]) : [],
    links: Array.isArray(draft["links"]) ? (draft["links"] as Link[]) : [],
    annotations: Array.isArray(draft["annotations"])
      ? (draft["annotations"] as GraphDoc["annotations"])
      : [],
  };
}

export function createEditorState(doc: GraphDoc): EditorState {
  return { past: [], present: doc, future: [], gesture: null };
}

/** Returns a copy of `target` with `value` at `path` (removing the key when `value` is undefined). */
export function setIn<T>(target: T, path: FieldPath, value: unknown): T {
  const [head, ...rest] = path;
  if (head === undefined) return value as T;
  if (Array.isArray(target)) {
    const copy: unknown[] = [...(target as unknown[])];
    copy[head as number] = setIn(copy[head as number], rest, value);
    return copy as T;
  }
  const record: Record<string, unknown> = isRecord(target) ? { ...target } : {};
  const key = String(head);
  if (rest.length === 0 && value === undefined) delete record[key];
  else record[key] = setIn(record[key], rest, value);
  return record as T;
}

function apply(doc: GraphDoc, action: EditorAction): GraphDoc {
  switch (action.type) {
    case "addNode":
      return { ...doc, nodes: [...doc.nodes, action.node] };
    case "moveNodes":
      return {
        ...doc,
        nodes: doc.nodes.map((node) => {
          const position = action.positions[node.id];
          return position && (position.x !== node.position.x || position.y !== node.position.y)
            ? { ...node, position }
            : node;
        }),
      };
    case "setNodeField":
      return {
        ...doc,
        nodes: doc.nodes.map((node) =>
          node.id === action.id ? setIn(node, action.path, action.value) : node,
        ),
      };
    case "addLink":
      return { ...doc, links: [...doc.links, action.link] };
    case "setLinkField":
      return {
        ...doc,
        links: doc.links.map((link) =>
          link.id === action.id ? setIn(link, action.path, action.value) : link,
        ),
      };
    case "remove": {
      const nodeIds = new Set(action.nodeIds ?? []);
      const linkIds = new Set(action.linkIds ?? []);
      const clear = new Set(action.clearTargets ?? []);
      return {
        ...doc,
        nodes: doc.nodes
          .filter((node) => !nodeIds.has(node.id))
          .map((node) =>
            node.type === "trigger" && (clear.has(node.id) || nodeIds.has(node.target))
              ? { ...node, target: "" }
              : node,
          ),
        links: doc.links.filter(
          (link) => !linkIds.has(link.id) && !nodeIds.has(link.from) && !nodeIds.has(link.to),
        ),
      };
    }
    case "rename":
      return { ...doc, name: action.name };
    default:
      return doc;
  }
}

/** The key under which consecutive edits merge into a single undo step (undefined: always a new step). */
function gestureOf(action: EditorAction): string | undefined {
  switch (action.type) {
    case "moveNodes":
      return action.gesture;
    case "setNodeField":
      return `node:${action.id}:${action.path.join(".")}`;
    case "setLinkField":
      return `link:${action.id}:${action.path.join(".")}`;
    case "rename":
      return "rename";
    default:
      return undefined;
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        gesture: null,
      };
    }
    case "redo": {
      const [next, ...future] = state.future;
      if (!next) return state;
      return { past: [...state.past, state.present], present: next, future, gesture: null };
    }
    case "endGesture":
      return state.gesture === null ? state : { ...state, gesture: null };
    case "load":
      return createEditorState(action.doc);
    default: {
      const present = apply(state.present, action);
      if (present === state.present) return state;
      const gesture = gestureOf(action) ?? null;
      if (gesture !== null && gesture === state.gesture) return { ...state, present, future: [] };
      return {
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present,
        future: [],
        gesture,
      };
    }
  }
}

// ---------- defaults for new blocks ----------

export type NewNodeKind = "agent-api" | "agent-terminal" | "tool" | "trigger";

export const defaultApiRuntime = () => ({ kind: "api" as const, provider: "anthropic", model: "" });

/** No `mode`: the schema defaults a missing one to the PTY, and the saved JSON stays minimal. */
export const defaultTerminalRuntime = () =>
  ({ kind: "terminal", cli: "claude", args: [], cwd: "" }) as unknown as AgentRuntime;

function uniqueAgentName(doc: GraphDoc): string {
  const taken = new Set(doc.nodes.flatMap((node) => (node.type === "agent" ? [node.name] : [])));
  for (let n = 1; ; n += 1) if (!taken.has(`Agente${n}`)) return `Agente${n}`;
}

export function defaultNode(
  kind: NewNodeKind,
  id: string,
  position: Position,
  doc: GraphDoc,
): GraphNode {
  switch (kind) {
    case "trigger":
      return { id, type: "trigger", position, kind: "manual", target: "" };
    case "tool":
      return {
        id,
        type: "tool",
        position,
        name: "Ferramenta",
        tool: { kind: "obsidian", vaultPath: "", readOnly: true },
      };
    default:
      return {
        id,
        type: "agent",
        position,
        name: uniqueAgentName(doc),
        role: "",
        instructions: "",
        effort: "medium",
        runtime: kind === "agent-api" ? defaultApiRuntime() : defaultTerminalRuntime(),
      };
  }
}

/** A free spot on the grid for the next block added from the toolbar. */
export function nextPosition(doc: GraphDoc): Position {
  const n = doc.nodes.length;
  return { x: GRID * 2 + (n % 4) * 260, y: GRID * 2 + Math.floor(n / 4) * 180 };
}

export const serialize = (doc: GraphDoc) => JSON.stringify(doc);

/**
 * What dragging an arrow from `sourceId` to `targetId` means: a conversation between two agents, an
 * agent using a tool, or a trigger starting an agent (the trigger's `target`, not a link).
 * Null when the pair is not allowed.
 */
export function connectionAction(
  doc: GraphDoc,
  sourceId: string,
  targetId: string,
  newLinkId: string,
): EditorAction | null {
  const source = doc.nodes.find((node) => node.id === sourceId);
  const target = doc.nodes.find((node) => node.id === targetId);
  if (!source || !target || source.id === target.id) return null;
  if (source.type === "trigger" && target.type === "agent") {
    return { type: "setNodeField", id: source.id, path: ["target"], value: target.id };
  }
  if (source.type === "agent" && target.type === "agent") {
    const link: Link = {
      id: newLinkId,
      from: source.id,
      to: target.id,
      kind: "talk",
      bidirectional: false,
    };
    return { type: "addLink", link };
  }
  if (source.type === "agent" && target.type === "tool") {
    const link: Link = {
      id: newLinkId,
      from: source.id,
      to: target.id,
      kind: "uses",
      bidirectional: false,
    };
    return { type: "addLink", link };
  }
  return null;
}
