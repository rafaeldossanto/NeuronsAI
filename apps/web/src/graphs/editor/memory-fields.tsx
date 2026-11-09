import type { GraphDefinition, ToolNode } from "@neurons/graph-schema";
import { FolderOpen, Network } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Field, Select, TextInput } from "@/shared/ui/fields";
import type { EditorAction, FieldPath } from "@/graphs/editor/model";
import { useWorkspace } from "@/workspace/resources";
import type { MemoryItem } from "@/memories/types";

export function MemoryFields({
  node,
  doc,
  dispatch,
  set,
}: {
  node: ToolNode;
  doc: GraphDefinition;
  dispatch: (action: EditorAction) => void;
  set: (path: FieldPath, value: unknown) => void;
}) {
  const workspace = useWorkspace();
  if (node.tool.kind !== "obsidian") return null;
  const tool = node.tool;
  const memory = workspace?.memories.data?.find((entry) => entry.id === tool.memoryId);
  const choose = (memory: MemoryItem) =>
    set(["tool"], { kind: "obsidian", memoryId: memory.id, readOnly: tool.readOnly });
  const links = doc.links.filter((link) => link.kind === "uses" && link.to === node.id);
  return (
    <>
      <Field label="Memória">
        <Select
          value={tool.memoryId ?? ""}
          onChange={(event) => {
            if (!event.target.value)
              set(["tool"], { kind: "obsidian", vaultPath: "", readOnly: tool.readOnly });
            else
              set(["tool"], {
                kind: "obsidian",
                memoryId: event.target.value,
                readOnly: tool.readOnly,
              });
          }}
        >
          <option value="">Pasta local / selecionar memória</option>
          {(workspace?.memories.data ?? []).map((entry) => (
            <option value={entry.id} key={entry.id}>
              {entry.name} · {entry.storage === "server" ? "Servidor" : (entry.runner ?? "Local")}
            </option>
          ))}
          {tool.memoryId && !memory && (
            <option value={tool.memoryId}>Memória não disponível</option>
          )}
        </Select>
      </Field>
      <Button variant="outline" size="sm" onClick={() => workspace?.addMemory(choose)}>
        <Network className="size-4" /> Adicionar memória
      </Button>
      {workspace?.memories.isError && (
        <p role="alert" className="text-xs text-destructive">
          Não foi possível carregar a biblioteca de memórias.
        </p>
      )}
      {memory && (
        <p className="text-xs text-muted-foreground">
          {memory.storage === "server"
            ? "Armazenada no servidor NeuronsAI."
            : `Cofre local cadastrado em ${memory.runner ?? "este computador"}.`}
        </p>
      )}
      {!tool.memoryId && (
        <Field label="Pasta do cofre" hint="Disponível no computador local do runner.">
          <div className="flex gap-2">
            <TextInput
              value={tool.vaultPath ?? ""}
              onChange={(event) => set(["tool", "vaultPath"], event.target.value)}
            />
            {window.neuronsDesktop && window.neuronsDesktop.localResources !== false && (
              <Button
                variant="outline"
                size="sm"
                aria-label="Selecionar pasta do cofre"
                onClick={() =>
                  void window.neuronsDesktop!.chooseDirectory().then((path) => {
                    if (path) set(["tool", "vaultPath"], path);
                  })
                }
              >
                <FolderOpen className="size-4" />
              </Button>
            )}
          </div>
        </Field>
      )}
      <Field label="Permissões da memória">
        <Select
          value={tool.readOnly ? "read" : "write"}
          onChange={(event) => set(["tool", "readOnly"], event.target.value === "read")}
        >
          <option value="read">Somente leitura</option>
          <option value="write">Leitura e escrita</option>
        </Select>
      </Field>
      <ul className="text-xs text-muted-foreground">
        <li>✓ Buscar e ler notas</li>
        <li>✓ Seguir links entre notas</li>
        {!tool.readOnly && (
          <>
            <li>✓ Criar notas</li>
            <li>✓ Editar notas</li>
          </>
        )}
      </ul>
      <h3 className="mt-2 text-sm font-semibold">Permissões por agente</h3>
      {links.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Ligue um agente a este bloco para conceder acesso.
        </p>
      )}
      {links.map((link) => {
        const agent = doc.nodes.find((entry) => entry.id === link.from);
        const name = agent?.type === "agent" ? agent.name : "Agente";
        return (
          <Field key={link.id} label={`Acesso de ${name}`}>
            <Select
              disabled={tool.readOnly}
              value={tool.readOnly || link.readOnly === true ? "read" : "write"}
              onChange={(event) =>
                dispatch({
                  type: "setLinkField",
                  id: link.id,
                  path: ["readOnly"],
                  value: event.target.value === "read",
                })
              }
            >
              <option value="read">Somente leitura</option>
              <option value="write">Leitura e escrita</option>
            </Select>
          </Field>
        );
      })}
      <p className="text-xs text-muted-foreground">
        O acesso vale apenas para os agentes ligados a esta memória. Criar ou editar notas não
        exclui arquivos.
      </p>
    </>
  );
}
