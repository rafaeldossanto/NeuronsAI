import type { Annotation } from "@neurons/graph-schema";
import mixed from "@neurons/graph-schema/examples/mixed.json";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { graph, graphId, renderApp } from "@/test/helpers";

const version = {
  id: "5d2a9e84-7c1b-4f30-a6e5-1d8b3c9f2a47",
  graphId,
  version: 2,
  createdAt: "2026-11-02T11:00:00.000Z",
};

const graphUrl = `/graphs/${graphId}`;

function open(draft: unknown, extra: Parameters<typeof renderApp>[1] = {}) {
  return renderApp(graphUrl, {
    [`GET ${graphUrl}`]: { body: { ...graph, draft } },
    [`GET ${graphUrl}/versions`]: { body: { items: [version] } },
    ...extra,
  });
}

const saved = (draft: unknown) => ({ body: { ...graph, draft } });
/** d3-drag (inside React Flow) needs a real `window` on mouse events, which jsdom's user-event lacks: click directly. */
const selectBlock = (testId: string) =>
  fireEvent.click(screen.getByTestId(testId).closest(".react-flow__node")!);
const problems = () => screen.getByRole("region", { name: "Problemas do grafo" });

describe("editor: carregar", () => {
  it("mostra os dados, o canvas com os blocos do rascunho e as versões", async () => {
    open(mixed);

    expect(screen.getByRole("status", { name: "Carregando grafo" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Revisão de código" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Canvas do grafo" })).toBeInTheDocument();
    expect(screen.getByTestId("block-agente-principal")).toHaveTextContent("Principal");
    expect(screen.getByTestId("block-agente-executor")).toHaveTextContent("Agente · Terminal");
    expect(screen.getByTestId("block-agente-principal")).toHaveTextContent("Agente · API");
    expect(screen.getByTestId("block-ferramenta-obsidian")).toHaveTextContent("Notas");
    expect(screen.getByTestId("block-gatilho-1")).toHaveTextContent("Gatilho");
    expect(await screen.findByText("v2")).toBeInTheDocument();
    expect(screen.getByText(/Nenhum problema/)).toBeInTheDocument();
  });

  it("sem rascunho, abre um canvas vazio e já aponta o que falta", async () => {
    open(null);
    expect(
      await screen.findByText("O grafo precisa de pelo menos um gatilho."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publicar versão/ })).toBeDisabled();
  });

  it("mostra o erro quando o grafo não existe", async () => {
    renderApp(graphUrl, {
      [`GET ${graphUrl}`]: {
        status: 404,
        body: { code: "graph_not_found", message: "Grafo não encontrado." },
      },
      [`GET ${graphUrl}/versions`]: {
        status: 404,
        body: { code: "graph_not_found", message: "Grafo não encontrado." },
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Grafo não encontrado.");
  });
});

describe("editor: validação ao vivo", () => {
  it("um agente novo traz erros; clicar no erro abre o bloco no inspetor; corrigir limpa", async () => {
    open(mixed);
    await screen.findByTestId("block-agente-principal");

    await userEvent.click(screen.getByRole("button", { name: "Agente de API" }));
    const list = problems();
    expect(within(list).getByText(/Agente1/)).toBeInTheDocument();
    expect(list).toHaveTextContent("runtime.model");

    await userEvent.click(within(list).getByRole("button"));
    const inspector = screen.getByRole("complementary", { name: "Inspetor" });
    expect(within(inspector).getByLabelText("Nome")).toHaveValue("Agente1");

    await userEvent.type(within(inspector).getByLabelText("Modelo"), "claude-opus-5-5");
    expect(screen.queryByRole("region", { name: "Problemas do grafo" })).not.toBeInTheDocument();
    expect(screen.getByText(/Nenhum problema/)).toBeInTheDocument();
  });

  it("marca o bloco com problema", async () => {
    open(mixed);
    await screen.findByTestId("block-agente-principal");
    await userEvent.click(screen.getByRole("button", { name: "Agente de terminal" }));
    const blocks = screen.getAllByTestId(/^block-/);
    const invalid = blocks.filter((block) => block.hasAttribute("data-invalid"));
    expect(invalid).toHaveLength(1);
    expect(within(invalid[0]!).getByLabelText(/problema/)).toBeInTheDocument();
  });

  it("não deixa publicar enquanto houver problema", async () => {
    open(mixed);
    await screen.findByTestId("block-agente-principal");
    const publish = screen.getByRole("button", { name: /Publicar versão/ });
    expect(publish).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Ferramenta" }));
    expect(publish).toBeDisabled();
  });
});

describe("editor: salvar e publicar", () => {
  it("salva o rascunho e preserva o que o canvas não edita", async () => {
    const draft = {
      ...mixed,
      annotations: [{ id: "nota-1", kind: "note", position: { x: 1, y: 2 }, text: "olá" }],
      extra: { guardado: true },
      nodes: mixed.nodes.map((node) =>
        node.id === "agente-principal" ? { ...node, campoDesconhecido: 42 } : node,
      ),
    };
    const { calls } = open(draft, { [`PATCH ${graphUrl}`]: saved(draft) });
    await screen.findByTestId("block-agente-principal");

    expect(screen.getByRole("button", { name: /Salvar rascunho/ })).toBeDisabled();
    expect(screen.getByText("Tudo salvo")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Ferramenta" }));
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Salvar rascunho/ }));

    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();
    expect(screen.getByText("Tudo salvo")).toBeInTheDocument();
    const patch = calls.find((call) => call.path === `PATCH ${graphUrl}`);
    const body = patch?.body as { draft: Record<string, unknown> & { nodes: unknown[] } };
    expect(body.draft["annotations"]).toEqual(draft.annotations);
    expect(body.draft["extra"]).toEqual({ guardado: true });
    expect(body.draft.nodes).toHaveLength(5);
    expect(body.draft.nodes).toContainEqual(
      expect.objectContaining({ id: "agente-principal", campoDesconhecido: 42 }),
    );
  });

  it("mostra o erro do servidor ao salvar", async () => {
    open(mixed, {
      [`PATCH ${graphUrl}`]: { status: 500, body: { code: "boom", message: "Falhou ao gravar." } },
    });
    await screen.findByTestId("block-agente-principal");
    await userEvent.click(screen.getByRole("button", { name: "Gatilho" }));
    await userEvent.click(screen.getByRole("button", { name: /Salvar rascunho/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falhou ao gravar.");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
  });

  it("publicar grava o rascunho pendente e depois publica a versão", async () => {
    const { calls } = open(mixed, {
      [`PATCH ${graphUrl}`]: saved(mixed),
      [`POST ${graphUrl}/versions`]: { status: 201, body: { ...version, version: 3 } },
    });
    await screen.findByTestId("block-agente-principal");

    selectBlock("block-agente-executor");
    const name = within(screen.getByRole("complementary", { name: "Inspetor" })).getByLabelText(
      "Nome",
    );
    await userEvent.type(name, "2");
    await userEvent.click(screen.getByRole("button", { name: /Publicar versão/ }));

    expect(await screen.findByText("Versão 3 publicada.")).toBeInTheDocument();
    const writes = calls.filter((c) => c.method === "PATCH" || c.method === "POST");
    expect(writes.map((c) => c.path)).toEqual([`PATCH ${graphUrl}`, `POST ${graphUrl}/versions`]);
    const sent = writes[0]?.body as { draft: { nodes: { name?: string }[] } };
    expect(sent.draft.nodes.map((n) => n.name)).toContain("Executor2");
  });

  it("sem alterações pendentes, publicar só chama a API de versões", async () => {
    const { calls } = open(mixed, {
      [`POST ${graphUrl}/versions`]: { status: 201, body: { ...version, version: 3 } },
    });
    await screen.findByTestId("block-agente-principal");
    await userEvent.click(screen.getByRole("button", { name: /Publicar versão/ }));
    expect(await screen.findByText("Versão 3 publicada.")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("mostra o motivo quando o servidor recusa a publicação", async () => {
    open(mixed, {
      [`POST ${graphUrl}/versions`]: {
        status: 422,
        body: { code: "graph_invalid", message: "O grafo tem problemas." },
      },
    });
    await screen.findByTestId("block-agente-principal");
    await userEvent.click(screen.getByRole("button", { name: /Publicar versão/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("O grafo tem problemas.");
  });
});

describe("editor: desfazer e refazer", () => {
  it("botões e atalhos Ctrl+Z / Ctrl+Shift+Z", async () => {
    open(mixed);
    await screen.findByTestId("block-agente-principal");
    const undo = screen.getByRole("button", { name: "Desfazer" });
    const redo = screen.getByRole("button", { name: "Refazer" });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Ferramenta" }));
    expect(screen.getAllByTestId(/^block-/)).toHaveLength(5);
    expect(undo).toBeEnabled();

    await userEvent.click(undo);
    expect(screen.getAllByTestId(/^block-/)).toHaveLength(4);
    expect(redo).toBeEnabled();
    expect(screen.getByText("Tudo salvo")).toBeInTheDocument();

    await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(screen.getAllByTestId(/^block-/)).toHaveLength(5);

    await userEvent.keyboard("{Control>}z{/Control}");
    expect(screen.getAllByTestId(/^block-/)).toHaveLength(4);
  });

  it("digitar num campo vira um passo só; desfazer volta o texto inteiro", async () => {
    open(mixed);
    await screen.findByTestId("block-agente-principal");
    selectBlock("block-agente-principal");
    const inspector = screen.getByRole("complementary", { name: "Inspetor" });
    await userEvent.type(within(inspector).getByLabelText("Papel"), " extra");
    expect(within(inspector).getByLabelText("Papel")).toHaveValue(
      "Planeja a tarefa e delega a execução extra",
    );

    await userEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    await waitFor(() =>
      expect(within(inspector).getByLabelText("Papel")).toHaveValue(
        "Planeja a tarefa e delega a execução",
      ),
    );
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeDisabled();
  });

  it("apagar a seleção remove o bloco e as setas dele, e dá para desfazer", async () => {
    open(mixed);
    await screen.findByTestId("block-agente-principal");
    selectBlock("block-ferramenta-obsidian");
    await userEvent.click(screen.getByRole("button", { name: "Apagar seleção" }));
    expect(screen.queryByTestId("block-ferramenta-obsidian")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    expect(screen.getByTestId("block-ferramenta-obsidian")).toBeInTheDocument();
    expect(screen.getByText(/Nenhum problema/)).toBeInTheDocument();
  });
});

describe("editor: camada livre", () => {
  /** Escolhe a ferramenta na barra e arrasta no canvas (o desenho usa mouse down/move/up). */
  const draw = (tool: string, from: [number, number], to: [number, number]) => {
    fireEvent.click(screen.getByRole("button", { name: tool }));
    const overlay = screen.getByTestId("draw-overlay");
    fireEvent.mouseDown(overlay, { button: 0, clientX: from[0], clientY: from[1] });
    fireEvent.mouseMove(window, { clientX: to[0], clientY: to[1] });
    fireEvent.mouseUp(window, { clientX: to[0], clientY: to[1] });
  };
  const kinds = () =>
    screen
      .queryAllByTestId(/^annotation-/)
      .map((el) => el.getAttribute("data-kind"))
      .sort();
  const toolbar = () => screen.getByRole("toolbar", { name: "Ferramentas do editor" });
  const ALL = ["arrow", "ellipse", "group", "note", "rect", "text"];

  it("anotar, salvar, reabrir e ver tudo no lugar; desfazer e refazer passam pelas anotações", async () => {
    const { calls } = open(mixed, { [`PATCH ${graphUrl}`]: saved(mixed) });
    await screen.findByTestId("block-agente-principal");

    draw("Retângulo", [100, 100], [260, 200]);
    draw("Elipse", [300, 100], [420, 180]);
    draw("Seta livre", [100, 300], [300, 320]);
    draw("Texto", [400, 300], [400, 300]);
    draw("Nota", [500, 100], [660, 200]);
    draw("Grupo", [-5000, -5000], [5000, 5000]);
    expect(kinds()).toEqual(ALL);

    // a nota recém-criada está selecionada: o inspetor edita o texto dela
    expect(screen.getByRole("heading", { name: "Grupo" })).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Nome do grupo"));
    await userEvent.type(screen.getByLabelText("Nome do grupo"), "Tudo junto");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Salvar rascunho/ }));
    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();

    const patch = calls.find((call) => call.path === `PATCH ${graphUrl}`);
    const draft = (
      patch?.body as { draft: { nodes: unknown; links: unknown; annotations: Annotation[] } }
    ).draft;
    expect(draft.annotations.map((a) => a.kind).sort()).toEqual(ALL);
    const group = draft.annotations.find((a) => a.kind === "group")!;
    expect(group.text).toBe("Tudo junto");
    // o grupo gigante envolve os cinco blocos e as outras cinco anotações
    expect(group.memberIds).toHaveLength(mixed.nodes.length + 5);
    // os blocos e as setas do grafo seguem iguais
    expect(draft.nodes).toEqual(mixed.nodes);
    expect(draft.links).toEqual(mixed.links);

    // reabrir com o rascunho que foi salvo: mesmo estado, nada alterado
    cleanup();
    open(draft);
    await screen.findByTestId("block-agente-principal");
    expect(kinds()).toEqual(ALL);
    expect(screen.getByText("Tudo salvo")).toBeInTheDocument();
    expect(screen.getByTestId(`annotation-${group.id}`)).toHaveAttribute("data-kind", "group");

    // desfazer e refazer: apagar uma anotação é um passo do mesmo histórico
    expect(within(toolbar()).getByRole("button", { name: "Desfazer" })).toBeDisabled();
    const rect = draft.annotations.find((a) => a.kind === "rect")!;
    fireEvent.click(screen.getByTestId(`annotation-${rect.id}`).closest(".react-flow__node")!);
    await userEvent.click(screen.getByRole("button", { name: "Apagar seleção" }));
    expect(kinds()).toEqual(ALL.filter((kind) => kind !== "rect"));
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    expect(kinds()).toEqual(ALL);
    expect(screen.getByText("Tudo salvo")).toBeInTheDocument();
    await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(kinds()).toEqual(ALL.filter((kind) => kind !== "rect"));
    expect(screen.getByText(/Nenhum problema/)).toBeInTheDocument();
  });

  it("as anotações ficam abaixo dos blocos e não impedem selecionar nem ligar blocos", async () => {
    const draft = {
      ...mixed,
      annotations: [
        {
          id: "g",
          kind: "group",
          position: { x: 0, y: 100 },
          size: { width: 900, height: 300 },
          memberIds: [],
        },
        { id: "r", kind: "rect", position: { x: 250, y: 100 }, size: { width: 300, height: 100 } },
      ],
    };
    open(draft);
    await screen.findByTestId("block-agente-principal");
    const z = (id: string) =>
      Number((screen.getByTestId(id).closest(".react-flow__node") as HTMLElement).style.zIndex);
    expect(z("annotation-r")).toBeLessThan(z("block-agente-principal"));
    expect(z("annotation-g")).toBeLessThan(z("annotation-r"));
    // grupos e setas só pegam o mouse no traço e no nome: o meio fica livre
    const group = screen.getByTestId("annotation-g").closest(".react-flow__node") as HTMLElement;
    expect(group.style.pointerEvents).toBe("none");

    selectBlock("block-agente-principal");
    expect(
      within(screen.getByRole("complementary", { name: "Inspetor" })).getByLabelText("Nome"),
    ).toHaveValue("Principal");
    expect(screen.getByText(/Nenhum problema/)).toBeInTheDocument();
  });

  it("atalhos de teclado trocam a ferramenta e Esc volta a selecionar", async () => {
    open(mixed);
    await screen.findByTestId("block-agente-principal");
    const pressed = (name: string) => screen.getByRole("button", { name });
    expect(pressed("Selecionar")).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("n");
    expect(pressed("Nota")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("draw-overlay")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(pressed("Selecionar")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("draw-overlay")).not.toBeInTheDocument();
    // digitando num campo, a letra é texto
    selectBlock("block-agente-principal");
    await userEvent.type(
      within(screen.getByRole("complementary", { name: "Inspetor" })).getByLabelText("Papel"),
      "rgt",
    );
    expect(pressed("Selecionar")).toHaveAttribute("aria-pressed", "true");
  });
});
