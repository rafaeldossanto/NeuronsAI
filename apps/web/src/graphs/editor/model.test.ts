import mixed from "@neurons/graph-schema/examples/mixed.json";
import { validateGraph } from "@neurons/graph-schema";
import { describe, expect, it } from "vitest";
import {
  connectionAction,
  createDoc,
  createEditorState,
  defaultNode,
  editorReducer,
  nextPosition,
  type EditorAction,
  type EditorState,
} from "./model";

function run(state: EditorState, ...actions: EditorAction[]) {
  return actions.reduce(editorReducer, state);
}

/** Draws `mixed.json` with the same actions the screen fires: add blocks, drag, type in the inspector, connect. */
function drawMixed() {
  let state = createEditorState(
    createDoc({ id: mixed.id, name: "Agente de API com executor de terminal", draft: null }),
  );
  const add = (kind: Parameters<typeof defaultNode>[0], id: string, x: number, y: number) => {
    const node = defaultNode(kind, id, nextPosition(state.present), state.present);
    state = run(state, { type: "addNode", node });
    state = run(state, { type: "moveNodes", positions: { [id]: { x, y } }, gesture: `drag:${id}` });
    state = run(state, { type: "endGesture" });
  };
  const set = (id: string, path: string[], value: unknown) => {
    state = run(state, { type: "setNodeField", id, path, value });
    state = run(state, { type: "endGesture" });
  };

  add("trigger", "gatilho-1", 0, 120);
  add("agent-api", "agente-principal", 260, 120);
  add("agent-terminal", "agente-executor", 560, 120);
  add("tool", "ferramenta-obsidian", 260, 320);

  set("agente-principal", ["name"], "Principal");
  set("agente-principal", ["role"], "Planeja a tarefa e delega a execução");
  set(
    "agente-principal",
    ["instructions"],
    "Entenda o pedido, consulte as notas no Obsidian e peça ao Executor que faça as alterações no projeto.",
  );
  set("agente-principal", ["effort"], "high");
  set("agente-principal", ["runtime", "model"], "claude-opus-5-5");

  set("agente-executor", ["name"], "Executor");
  set("agente-executor", ["role"], "Executa alterações de código no projeto");
  set(
    "agente-executor",
    ["instructions"],
    "Execute com cuidado o que o Principal pedir, rode os testes e relate o resultado.",
  );
  set("agente-executor", ["runtime", "cwd"], "C:\\Users\\exemplo\\Projetos\\meu-projeto");

  set("ferramenta-obsidian", ["name"], "Notas");
  set("ferramenta-obsidian", ["tool", "vaultPath"], "C:\\Users\\exemplo\\Documentos\\Obsidian");

  const connect = (from: string, to: string, linkId: string) => {
    const action = connectionAction(state.present, from, to, linkId);
    expect(action).not.toBeNull();
    state = run(state, action!);
  };
  connect("gatilho-1", "agente-principal", "");
  connect("agente-principal", "agente-executor", "ligacao-conversa");
  state = run(state, {
    type: "setLinkField",
    id: "ligacao-conversa",
    path: ["bidirectional"],
    value: true,
  });
  connect("agente-principal", "ferramenta-obsidian", "ligacao-notas");
  return state;
}

describe("desenhar o mixed.json do zero", () => {
  it("gera um JSON igual à fixture (posições incluídas)", () => {
    const state = drawMixed();
    expect(state.present).toEqual(mixed);
    expect(validateGraph(state.present).ok).toBe(true);
  });

  it("desfazer tudo volta ao grafo vazio e refazer tudo volta à fixture", () => {
    const state = drawMixed();
    const undone = Array.from({ length: state.past.length }).reduce<EditorState>(
      (s) => editorReducer(s, { type: "undo" }),
      state,
    );
    expect(undone.present.nodes).toEqual([]);
    expect(undone.present.links).toEqual([]);
    const redone = Array.from({ length: state.past.length }).reduce<EditorState>(
      (s) => editorReducer(s, { type: "redo" }),
      undone,
    );
    expect(redone.present).toEqual(mixed);
  });
});
