import type { GraphDefinition, GraphNode, Link } from "@neurons/graph-schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useReducer } from "react";
import { describe, expect, it } from "vitest";
import { Inspector, type Selection } from "./inspector";
import { validateDoc } from "./issues";
import { createDoc, createEditorState, editorReducer, type GraphDoc } from "./model";

const position = { x: 0, y: 0 };

const whatsappGraph: GraphDefinition = {
  schemaVersion: 1,
  id: "5b440250-ceba-42f4-8ce6-717a290384c4",
  name: "Atendimento",
  annotations: [],
  nodes: [
    {
      id: "gatilho",
      type: "trigger",
      position,
      kind: "whatsapp",
      target: "atendente",
      phoneNumberId: "106540352242922",
      appSecretName: "whatsapp-app-secret",
    },
    {
      id: "atendente",
      type: "agent",
      position,
      name: "Atendente",
      role: "Atende",
      instructions: "Responda.",
      effort: "medium",
      runtime: { kind: "api", provider: "anthropic", model: "claude-sonnet-5-5" },
    },
    {
      id: "resposta",
      type: "tool",
      position,
      name: "Resposta",
      tool: { kind: "whatsapp", phoneNumberId: "106540352242922", accessTokenSecret: "token-meta" },
    },
    {
      id: "pedidos",
      type: "tool",
      position,
      name: "Registrar pedido",
      tool: { kind: "http", method: "POST", url: "https://pedidos.exemplo.com/novo", headers: {} },
    },
  ],
  links: [
    { id: "l1", from: "atendente", to: "resposta", kind: "uses", bidirectional: false },
    { id: "l2", from: "atendente", to: "pedidos", kind: "uses", bidirectional: false },
  ],
};

const seen: { doc: GraphDoc | null } = { doc: null };

function Harness({ selection }: { selection: Selection }) {
  const [state, dispatch] = useReducer(
    editorReducer,
    createDoc({ ...whatsappGraph, draft: whatsappGraph }),
    (doc) => createEditorState(doc),
  );
  useEffect(() => {
    seen.doc = state.present;
  });
  return (
    <Inspector
      doc={state.present}
      selection={selection}
      issues={validateDoc(state.present)}
      dispatch={dispatch}
    />
  );
}

const node = (id: string) => seen.doc!.nodes.find((n) => n.id === id) as GraphNode;
const link = (id: string) => seen.doc!.links.find((l) => l.id === id) as Link;

describe("inspetor do WhatsApp", () => {
  it("gatilho: mostra o número e o nome do segredo, e grava as edições", async () => {
    render(<Harness selection={{ nodeIds: ["gatilho"], linkIds: [] }} />);
    expect(screen.getByLabelText("Phone number ID")).toHaveValue("106540352242922");
    expect(screen.getByLabelText("Nome do segredo do App Secret")).toHaveValue(
      "whatsapp-app-secret",
    );

    const secret = screen.getByLabelText("Nome do segredo do App Secret");
    await userEvent.clear(secret);
    await userEvent.type(secret, "meu-app-secret");
    expect(node("gatilho")).toMatchObject({ appSecretName: "meu-app-secret" });
  });

  it("gatilho: avisa que o agente começa sem ferramentas de escrita e diz quais ficam bloqueadas", () => {
    render(<Harness selection={{ nodeIds: ["gatilho"], linkIds: [] }} />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Atendente");
    expect(note).toHaveTextContent("sem ferramentas de escrita");
    expect(note).toHaveTextContent("Registrar pedido");
    expect(note).not.toHaveTextContent("Resposta");
  });

  it("trocar o tipo para WhatsApp pré-preenche o nome do segredo e trocar de volta limpa os campos", async () => {
    render(<Harness selection={{ nodeIds: ["gatilho"], linkIds: [] }} />);
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "manual");
    expect(node("gatilho")).not.toHaveProperty("phoneNumberId");
    expect(node("gatilho")).not.toHaveProperty("appSecretName");
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "whatsapp");
    expect(node("gatilho")).toMatchObject({ appSecretName: "whatsapp-app-secret" });
  });

  it("ferramenta de resposta: mostra o número e o nome do segredo do token", async () => {
    render(<Harness selection={{ nodeIds: ["resposta"], linkIds: [] }} />);
    expect(screen.getByLabelText("Tipo")).toHaveValue("whatsapp");
    expect(screen.getByLabelText("Phone number ID")).toHaveValue("106540352242922");
    const token = screen.getByLabelText("Nome do segredo do access token");
    expect(token).toHaveValue("token-meta");
    await userEvent.clear(token);
    await userEvent.type(token, "outro-token");
    expect(node("resposta")).toMatchObject({ tool: { accessTokenSecret: "outro-token" } });
  });

  it("ligação com o agente que lê clientes: marcar Permitir escrita grava allowWrite", async () => {
    render(<Harness selection={{ nodeIds: [], linkIds: ["l2"] }} />);
    const box = screen.getByRole("checkbox", { name: /Permitir escrita/ });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(link("l2")).toMatchObject({ allowWrite: true });
    await userEvent.click(box);
    expect(link("l2")).not.toHaveProperty("allowWrite");
  });
});
