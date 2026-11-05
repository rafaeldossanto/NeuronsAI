import { useRef, useState, type FormEvent } from "react";
import { CloudUpload, FolderOpen, Monitor, Network } from "lucide-react";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/editor/fields";
import { unwrap } from "@/lib/api";
import { importMemoryFiles } from "./memory-import";
import { useWorkspace, type MemoryItem } from "./resources";

export function AddMemoryPanel({
  onCreated,
  onClose,
}: {
  onCreated: (memory: MemoryItem) => void;
  onClose: () => void;
}) {
  const workspace = useWorkspace()!;
  const [name, setName] = useState("Memória do projeto");
  const [source, setSource] = useState<"local" | "import" | "server">("server");
  const [vaultPath, setVaultPath] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const folder = useRef<HTMLInputElement>(null);
  const zip = useRef<HTMLInputElement>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      if (source === "import" && files.length === 0)
        throw new Error("Selecione uma pasta ou um ZIP para importar.");
      const imported = source === "import" ? await importMemoryFiles(files) : undefined;
      if (imported && imported.length === 0)
        throw new Error("Nenhum arquivo foi encontrado para importar.");
      const memory = await unwrap(
        workspace.api.POST("/memories", {
          body: {
            name,
            storage: source === "local" ? "local" : "server",
            ...(source === "local" && { vaultPath }),
            ...(imported && { files: imported }),
          },
        }),
      );
      await workspace.refresh();
      onCreated(memory);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Não foi possível adicionar a memória.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal title="Adicionar memória" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">Escolha onde a memória ficará disponível.</p>
        <Field label="Nome da memória">
          <TextInput
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-3" role="radiogroup" aria-label="Origem da memória">
          {(
            [
              [
                "local",
                Monitor,
                "Conectar cofre local",
                "Usa uma pasta neste computador, no perfil local.",
              ],
              [
                "import",
                CloudUpload,
                "Importar cofre para o servidor",
                "Envia uma cópia das notas e dos anexos.",
              ],
              [
                "server",
                Network,
                "Criar memória no servidor",
                "Comece com um cofre vazio e persistente.",
              ],
            ] as const
          ).map(([value, Icon, title, hint]) => (
            <label
              key={value}
              className={`resource-choice ${source === value ? "is-selected" : ""}`}
            >
              <input
                type="radio"
                name="memory-source"
                value={value}
                checked={source === value}
                disabled={value === "local" && workspace.connections.data?.profile !== "local"}
                onChange={() => setSource(value)}
              />
              <Icon className="size-5 shrink-0" />
              <span>
                <b className="block text-sm">{title}</b>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        {source === "local" && (
          <Field label="Pasta do cofre">
            <div className="flex gap-2">
              <TextInput
                required
                value={vaultPath}
                placeholder="Caminho absoluto do cofre"
                onChange={(e) => setVaultPath(e.target.value)}
              />
              {window.neuronsDesktop && window.neuronsDesktop.localResources !== false && (
                <Button
                  type="button"
                  variant="outline"
                  aria-label="Selecionar pasta do cofre"
                  onClick={() =>
                    void window.neuronsDesktop!.chooseDirectory().then((path) => {
                      if (path) setVaultPath(path);
                    })
                  }
                >
                  <FolderOpen className="size-4" />
                </Button>
              )}
            </div>
          </Field>
        )}
        {source === "import" && (
          <div className="rounded-lg border border-dashed p-4">
            <input
              ref={folder}
              hidden
              type="file"
              multiple
              {...{ webkitdirectory: "" }}
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
            <input
              ref={zip}
              hidden
              type="file"
              accept=".zip"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => folder.current?.click()}>
                Selecionar pasta
              </Button>
              <Button type="button" variant="outline" onClick={() => zip.current?.click()}>
                Selecionar ZIP
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {files.length > 0
                ? `${files.length} arquivo(s) selecionado(s).`
                : "Até 20 MB e 1000 arquivos, incluindo anexos. Pastas internas do Obsidian não são importadas."}
            </p>
          </div>
        )}
        {source !== "local" && (
          <p className="text-xs text-muted-foreground">
            A memória será armazenada nos dados do servidor NeuronsAI. Importar cria uma cópia; não
            sincroniza a pasta local automaticamente.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Adicionando…" : "Adicionar memória"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
