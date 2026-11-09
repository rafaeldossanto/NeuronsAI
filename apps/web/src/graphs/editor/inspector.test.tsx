import type { GraphNode } from "@neurons/graph-schema";
import mixed from "@neurons/graph-schema/examples/mixed.json";
import { render, screen, within } from "@testing-library/react";
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

  it("gatilho agendado explica o cron em português e lista as 3 próximas execuções", async () => {
    render(<Harness selection={{ nodeIds: ["gatilho-1"], linkIds: [] }} />);
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "schedule");
    await userEvent.type(screen.getByLabelText("Expressão cron"), "0 9 * * 1");

    expect(screen.getByText("Às 09:00, somente de segunda-feira")).toBeInTheDocument();
    const next = screen.getByRole("list", { name: "Próximas execuções" });
    expect(within(next).getAllByRole("listitem")).toHaveLength(3);
    for (const item of within(next).getAllByRole("listitem"))
      expect(item).toHaveTextContent("09:00");
  });

  it("gatilho agendado: cron inválido mostra o motivo na hora e some a prévia", async () => {
    render(<Harness selection={{ nodeIds: ["gatilho-1"], linkIds: [] }} />);
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "schedule");
    await userEvent.type(screen.getByLabelText("Expressão cron"), "toda segunda");

    expect(screen.getByRole("alert")).toHaveTextContent("Expressão cron inválida");
    expect(screen.queryByRole("list", { name: "Próximas execuções" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Problemas deste item" })).toHaveTextContent(
      "Expressão cron inválida",
    );
  });

  it("gatilho agendado: o fuso entra no bloco e a prévia o usa; fuso desconhecido avisa", async () => {
    render(<Harness selection={{ nodeIds: ["gatilho-1"], linkIds: [] }} />);
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "schedule");
    await userEvent.type(screen.getByLabelText("Expressão cron"), "0 9 * * *");
    await userEvent.type(screen.getByLabelText("Fuso horário"), "America/Sao_Paulo");

    expect(node("gatilho-1")).toMatchObject({ timezone: "America/Sao_Paulo" });
    expect(screen.getByText(/Próximas execuções \(America\/Sao_Paulo\)/)).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Fuso horário"));
    expect(node("gatilho-1")).not.toHaveProperty("timezone");
    await userEvent.type(screen.getByLabelText("Fuso horário"), "Marte/Olympus");
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("Fuso horário desconhecido");
  });

  it("trocar o gatilho para manual apaga o cron e o fuso", async () => {
    render(<Harness selection={{ nodeIds: ["gatilho-1"], linkIds: [] }} />);
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "schedule");
    await userEvent.type(screen.getByLabelText("Expressão cron"), "0 9 * * *");
    await userEvent.type(screen.getByLabelText("Fuso horário"), "UTC");

    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "manual");

    expect(node("gatilho-1")).not.toHaveProperty("cron");
    expect(node("gatilho-1")).not.toHaveProperty("timezone");
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
