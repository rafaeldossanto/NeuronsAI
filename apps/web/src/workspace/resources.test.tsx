import { useReducer } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createQueryClient } from "@/app";
import { ApiProvider, createApi } from "@/shared/api";
import { mockFetch } from "@/test/helpers";
import { Inspector } from "@/graphs/editor/inspector";
import { createDoc, createEditorState, editorReducer } from "@/graphs/editor/model";
import { WorkspaceProvider } from "./resources";

function Harness() {
  const [state, dispatch] = useReducer(
    editorReducer,
    createEditorState(
      createDoc({
        id: "g",
        name: "Memória",
        draft: {
          nodes: [
            {
              id: "m",
              name: "Notas",
              type: "tool",
              position: { x: 0, y: 0 },
              tool: { kind: "obsidian", vaultPath: "", readOnly: true },
            },
          ],
          links: [],
        },
      }),
    ),
  );
  return (
    <>
      <Inspector
        doc={state.present}
        selection={{ nodeIds: ["m"], linkIds: [] }}
        issues={[]}
        dispatch={dispatch}
      />
      <output data-testid="document">{JSON.stringify(state.present)}</output>
    </>
  );
}

describe("configuração de memória", () => {
  it("cadastra uma memória do servidor e salva a referência e a permissão no bloco", async () => {
    const memory = {
      id: "628782b8-1e97-41ce-a6f8-c6034e83b887",
      name: "Memória do projeto",
      storage: "server",
      fileCount: 0,
      createdAt: "2026-11-04T10:00:00.000Z",
    };
    let created = false;
    const mocked = mockFetch({
      "GET /memories": () => ({ body: { items: created ? [memory] : [] } }),
      "POST /memories": () => {
        created = true;
        return { status: 201, body: memory };
      },
      "GET /connections": {
        body: {
          profile: "local",
          secretsEnabled: true,
          claude: {
            installed: false,
            connected: false,
            signingIn: false,
            message: "Instale a CLI",
          },
          chatgpt: { available: false, message: "Em breve" },
        },
      },
      "GET /secrets": { body: { names: [] } },
    });
    render(
      <ApiProvider api={createApi(mocked.fetch)}>
        <QueryClientProvider client={createQueryClient()}>
          <WorkspaceProvider>
            <Harness />
          </WorkspaceProvider>
        </QueryClientProvider>
      </ApiProvider>,
    );
    await userEvent.selectOptions(screen.getByLabelText("Permissões da memória"), "write");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar memória" }));
    const dialog = await screen.findByRole("dialog", { name: "Adicionar memória" });
    expect(within(dialog).getByRole("radio", { name: /Criar memória no servidor/ })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("button", { name: "Adicionar memória" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const doc = JSON.parse(screen.getByTestId("document").textContent ?? "{}") as {
      nodes: { tool: unknown }[];
    };
    expect(doc.nodes[0]?.tool).toEqual({ kind: "obsidian", memoryId: memory.id, readOnly: false });
    expect(mocked.calls.find((call) => call.path === "POST /memories")?.body).toEqual({
      name: "Memória do projeto",
      storage: "server",
    });
    expect(screen.getByText("Armazenada no servidor NeuronsAI.")).toBeInTheDocument();
  });
});
