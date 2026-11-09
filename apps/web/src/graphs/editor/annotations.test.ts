import mixed from "@neurons/graph-schema/examples/mixed.json";
import { validateGraph, type Annotation } from "@neurons/graph-schema";
import { describe, expect, it } from "vitest";
import { createAnnotation, itemsInside, NODE_FALLBACK } from "./annotations";
import {
  createDoc,
  createEditorState,
  editorReducer,
  type EditorAction,
  type EditorState,
  type GraphDoc,
} from "./model";

const run = (state: EditorState, ...actions: EditorAction[]) =>
  actions.reduce(editorReducer, state);
const start = () => createEditorState(createDoc({ ...mixed, draft: mixed }));
const at = (x: number, y: number) => ({ x, y });
const byId = (doc: GraphDoc, id: string) => doc.annotations.find((a) => a.id === id) as Annotation;

describe("anotações no reducer", () => {
  it("criar, mover, redimensionar, editar texto e apagar são passos do mesmo histórico", () => {
    const rect = createAnnotation("rect", "r1", at(0, 0), at(200, 120), start().present);
    let state = run(start(), { type: "addAnnotation", annotation: rect });
    expect(state.past).toHaveLength(1);

    state = run(
      state,
      { type: "moveNodes", positions: { r1: at(40, 60) }, gesture: "drag" },
      { type: "moveNodes", positions: { r1: at(50, 70) }, gesture: "drag" },
      { type: "endGesture" },
    );
    expect(state.past).toHaveLength(2); // arrastar vira um passo só
    state = run(
      state,
      {
        type: "resizeAnnotation",
        id: "r1",
        position: at(50, 70),
        size: { width: 90, height: 50 },
        gesture: "resize",
      },
      {
        type: "resizeAnnotation",
        id: "r1",
        position: at(50, 70),
        size: { width: 99, height: 55 },
        gesture: "resize",
      },
      { type: "endGesture" },
    );
    expect(state.past).toHaveLength(3);
    state = run(
      state,
      { type: "setAnnotationField", id: "r1", path: ["text"], value: "A" },
      { type: "setAnnotationField", id: "r1", path: ["text"], value: "AB" },
    );
    expect(state.past).toHaveLength(4); // digitar vira um passo só
    expect(byId(state.present, "r1")).toMatchObject({
      position: at(50, 70),
      size: { width: 99, height: 55 },
      text: "AB",
    });

    const full = state.present;
    state = run(state, { type: "remove", annotationIds: ["r1"] });
    expect(state.present.annotations).toHaveLength(0);

    // desfazer tudo, passo a passo, até o grafo original; refazer volta ao mesmo documento
    const undone = Array.from({ length: 5 }).reduce<EditorState>(
      (current) => run(current, { type: "undo" }),
      state,
    );
    expect(undone.present).toEqual(start().present);
    const redone = Array.from({ length: 5 }).reduce<EditorState>(
      (current) => run(current, { type: "redo" }),
      undone,
    );
    expect(redone.present.annotations).toHaveLength(0);
    expect(run(redone, { type: "undo" }).present).toEqual(full);
  });

  it("mover um grupo leva os blocos e as anotações dele, inclusive grupos aninhados", () => {
    const doc = start().present;
    const principal = doc.nodes.find((n) => n.id === "agente-principal")!.position;
    const note: Annotation = {
      id: "n1",
      kind: "note",
      position: at(10, 10),
      size: { width: 50, height: 50 },
    };
    const inner: Annotation = {
      id: "g2",
      kind: "group",
      position: at(0, 0),
      size: { width: 80, height: 80 },
      memberIds: ["n1"],
    };
    const outer: Annotation = {
      id: "g1",
      kind: "group",
      position: at(0, 0),
      size: { width: 500, height: 500 },
      memberIds: ["agente-principal", "g2"],
    };
    let state = run(
      start(),
      { type: "addAnnotation", annotation: note },
      { type: "addAnnotation", annotation: inner },
      { type: "addAnnotation", annotation: outer },
    );
    state = run(state, { type: "moveNodes", positions: { g1: at(100, 40) }, gesture: "drag" });
    const next = state.present;
    expect(next.nodes.find((n) => n.id === "agente-principal")!.position).toEqual(
      at(principal.x + 100, principal.y + 40),
    );
    expect(byId(next, "g2").position).toEqual(at(100, 40));
    expect(byId(next, "n1").position).toEqual(at(110, 50));
    expect(validateGraph(next)).toMatchObject({ ok: true });

    // se o membro também foi arrastado (seleção em caixa), não se move duas vezes
    const both = run(state, {
      type: "moveNodes",
      positions: { g1: at(200, 40), "agente-principal": at(principal.x + 100, principal.y + 40) },
    }).present;
    expect(both.nodes.find((n) => n.id === "agente-principal")!.position).toEqual(
      at(principal.x + 100, principal.y + 40),
    );
  });

  it("apagar um item o tira dos grupos; o grafo continua válido", () => {
    const group: Annotation = {
      id: "g1",
      kind: "group",
      position: at(0, 0),
      size: { width: 900, height: 900 },
      memberIds: ["agente-executor", "n1"],
    };
    const note: Annotation = { id: "n1", kind: "note", position: at(5, 5) };
    let state = run(
      start(),
      { type: "addAnnotation", annotation: note },
      { type: "addAnnotation", annotation: group },
    );
    state = run(state, { type: "remove", annotationIds: ["n1"] });
    expect(byId(state.present, "g1").memberIds).toEqual(["agente-executor"]);
    state = run(state, { type: "remove", nodeIds: ["agente-executor"] });
    expect(byId(state.present, "g1").memberIds).toEqual([]);
    const result = validateGraph(state.present);
    const codes = result.ok ? [] : result.issues.map((issue) => issue.code);
    expect(codes).not.toContain("group_member_not_found");
  });
});

describe("criar anotações", () => {
  const doc = start().present;

  it("um clique dá o tamanho padrão; arrastar de trás para frente normaliza a caixa", () => {
    expect(createAnnotation("rect", "a", at(10, 10), at(10, 10), doc)).toMatchObject({
      kind: "rect",
      position: at(10, 10),
      size: { width: 160, height: 100 },
    });
    expect(createAnnotation("ellipse", "b", at(100, 80), at(40, 20), doc)).toMatchObject({
      position: at(40, 20),
      size: { width: 60, height: 60 },
    });
  });

  it("a seta guarda os pontos relativos ao canto da caixa que ocupa", () => {
    const arrow = createAnnotation("arrow", "s", at(100, 50), at(20, 90), doc);
    expect(arrow.position).toEqual(at(20, 50));
    expect(arrow.points).toEqual([at(80, 0), at(0, 40)]);
  });

  it("o grupo envolve os blocos e as anotações que cabem inteiros dentro", () => {
    const executor = doc.nodes.find((n) => n.id === "agente-executor")!.position;
    const note: Annotation = {
      id: "n1",
      kind: "note",
      position: at(executor.x, executor.y + 100),
      size: { width: 40, height: 40 },
    };
    const withNote = createDoc({ ...mixed, draft: { ...mixed, annotations: [note] } });
    const group = createAnnotation(
      "group",
      "g",
      at(executor.x - 10, executor.y - 10),
      at(executor.x + NODE_FALLBACK.width + 10, executor.y + 200),
      withNote,
    );
    expect(group.memberIds).toEqual(["agente-executor", "n1"]);
    expect(itemsInside(withNote, { x: -9999, y: -9999, width: 20000, height: 20000 })).toContain(
      "n1",
    );
  });
});
