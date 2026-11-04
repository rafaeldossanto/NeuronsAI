import type { GraphNode } from "@neurons/graph-schema";
import mixed from "@neurons/graph-schema/examples/mixed.json";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useReducer } from "react";
import { describe, expect, it } from "vitest";
import { Inspector, type Selection } from "./inspector";
import { validateDoc } from "./issues";
import { createDoc, createEditorState, editorReducer, type GraphDoc } from "./model";

/** The document as the harness last rendered it, for assertions. */
const seen: { doc: GraphDoc | null } = { doc: null };

function Harness({ selection }: { selection: Selection }) {
  const [state, dispatch] = useReducer(
    editorReducer,
    createDoc({ ...mixed, draft: mixed }),
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

describe("inspetor", () => {
  it("sem seleção, edita o nome do grafo", async () => {
    render(<Harness selection={{ nodeIds: [], linkIds: [] }} />);
    const name = screen.getByLabelText("Nome do grafo");
    await userEvent.clear(name);
    await userEvent.type(name, "Outro");
    expect(seen.doc!.name).toBe("Outro");
  });

  it("agente de API: mostra os campos e grava as edições no bloco", async () => {
    render(<Harness selection={{ nodeIds: ["agente-principal"], linkIds: [] }} />);
    expect(screen.getByLabelText("Fornecedor")).toHaveValue("anthropic");
    expect(screen.getByLabelText("Modelo")).toHaveValue("claude-opus-5-5");
    expect(screen.getByLabelText("Esforço")).toHaveValue("high");
    expect(screen.queryByLabelText("Pasta de trabalho")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Esforço"), "max");
    await userEvent.type(screen.getByLabelText("Orçamento (US$)"), "2.5");
    await userEvent.clear(screen.getByLabelText("Papel"));
    await userEvent.type(screen.getByLabelText("Papel"), "Líder");

    const agent = node("agente-principal");
    expect(agent).toMatchObject({ effort: "max", budgetUsd: 2.5, role: "Líder" });
    // Quem ele pode chamar e as ferramentas ligadas a ele vêm do contrato.
    expect(screen.getByText("Executor")).toBeInTheDocument();
    expect(screen.getByText("Notas")).toBeInTheDocument();
  });

  it("apagar o orçamento remove a chave (não grava vazio nem NaN)", async () => {
    render(<Harness selection={{ nodeIds: ["agente-principal"], linkIds: [] }} />);
    const budget = screen.getByLabelText("Orçamento (US$)");
    await userEvent.type(budget, "3");
    expect(node("agente-principal")).toHaveProperty("budgetUsd", 3);
    await userEvent.clear(budget);
    expect(node("agente-principal")).not.toHaveProperty("budgetUsd");
  });

  it("agente de terminal: CLI, pasta e argumentos; trocar para API troca o runtime", async () => {
    render(<Harness selection={{ nodeIds: ["agente-executor"], linkIds: [] }} />);
    expect(screen.getByLabelText("CLI")).toHaveValue("claude");
    expect(screen.getByLabelText("Pasta de trabalho")).toHaveValue(
      "C:\\Users\\exemplo\\Projetos\\meu-projeto",
    );
    await userEvent.type(screen.getByLabelText("Argumentos"), "--verbose{Enter}-p");
    expect(node("agente-executor")).toMatchObject({
      runtime: { args: ["--verbose", "-p"] },
    });

    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "api");
    expect(node("agente-executor")).toMatchObject({
      runtime: { kind: "api", provider: "anthropic" },
    });
  });

  it("mostra os problemas do bloco selecionado", async () => {
    render(<Harness selection={{ nodeIds: ["agente-principal"], linkIds: [] }} />);
    await userEvent.clear(screen.getByLabelText("Nome"));
    await userEvent.type(screen.getByLabelText("Nome"), "1ruim");
    expect(screen.getByRole("list", { name: "Problemas deste item" })).toHaveTextContent(
      "O nome do agente deve começar com letra",
    );
  });

  it("gatilho agendado exige cron e escolhe o agente alvo", async () => {
    render(<Harness selection={{ nodeIds: ["gatilho-1"], linkIds: [] }} />);
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "schedule");
    expect(screen.getByRole("list", { name: "Problemas deste item" })).toHaveTextContent("cron");
    await userEvent.type(screen.getByLabelText("Expressão cron"), "0 9 * * *");
    await userEvent.selectOptions(screen.getByLabelText("Inicia o agente"), "Executor");
    expect(node("gatilho-1")).toMatchObject({
      kind: "schedule",
      cron: "0 9 * * *",
      target: "agente-executor",
    });
  });

  it("ferramenta: edita a pasta do cofre", async () => {
    render(<Harness selection={{ nodeIds: ["ferramenta-obsidian"], linkIds: [] }} />);
    const vault = screen.getByLabelText("Pasta do cofre");
    await userEvent.clear(vault);
    await userEvent.type(vault, "D:/cofre");
    expect(node("ferramenta-obsidian")).toMatchObject({ tool: { vaultPath: "D:/cofre" } });
  });

  it("seta de conversa: alterna a seta dupla", async () => {
    render(<Harness selection={{ nodeIds: [], linkIds: ["ligacao-conversa"] }} />);
    const box = screen.getByRole("checkbox", { name: /Seta dupla/ });
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(seen.doc!.links.find((l) => l.id === "ligacao-conversa")?.bidirectional).toBe(false);
  });
});
