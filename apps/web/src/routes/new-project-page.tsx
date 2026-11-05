import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { FolderOpen, Network } from "lucide-react";
import {
  instantiateTemplate,
  listTemplates,
  validateGraph,
  type GraphTemplate,
} from "@neurons/graph-schema";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { unwrap, useApi } from "@/lib/api";
import { useCreateGraph } from "@/lib/queries";
import { TemplateCard } from "@/templates/template-card";

const templates = listTemplates();

/** A template becomes an independent draft; creating a project never publishes or starts it. */
export function NewProjectPage() {
  const create = useCreateGraph();
  const api = useApi();
  const navigate = useNavigate();
  const busy = useRef(false);
  const createdId = useRef<string | null>(null);
  const [selected, setSelected] = useState<GraphTemplate | null>(null);
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function choose(template: GraphTemplate) {
    if (busy.current) return;
    createdId.current = null;
    setSelected(template);
    setName(template.name);
    setCwd("");
    setError("");
  }

  async function createProject(template: GraphTemplate | null) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const projectName = template ? name.trim() : "Projeto sem nome";
      if (!projectName) throw new Error("Informe o nome do projeto.");
      if (template) {
        const preview = instantiateTemplate(template.id, {
          projectId: crypto.randomUUID(),
          name: projectName,
          cwd,
        });
        const validation = validateGraph(preview);
        if (!validation.ok)
          throw new Error(validation.issues.map((issue) => issue.message).join(" "));
      }
      // A failed PATCH can be retried without creating another empty project.
      if (!createdId.current) createdId.current = (await create.mutateAsync(projectName)).id;
      const id = createdId.current;
      if (template) {
        const draft = instantiateTemplate(template.id, { projectId: id, name: projectName, cwd });
        await unwrap(
          api.PATCH("/graphs/{id}", {
            params: { path: { id } },
            body: { name: projectName, draft },
          }),
        );
      }
      await navigate(`/graphs/${id}`, { replace: true });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível criar o projeto.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void createProject(selected);
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Novo projeto</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Comece do zero ou use um template. Cada modelo vira um rascunho independente para você
          revisar e publicar.
        </p>
      </header>
      {error && !selected && (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-destructive">
          <p>{error}</p>
          <Button variant="outline" disabled={pending} onClick={() => void createProject(null)}>
            Tentar novamente
          </Button>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col gap-4 p-6" role="article" aria-label="Projeto em branco">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Do seu jeito
          </span>
          <div>
            <h2 className="text-xl font-semibold">Projeto em branco</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Um canvas vazio para montar seus próprios agentes, ferramentas e conexões.
            </p>
          </div>
          <div className="flex h-56 flex-col items-center justify-center gap-4 rounded-lg border border-dashed bg-background text-muted-foreground">
            <Network className="size-10" aria-hidden />
            <p className="text-sm">Seu primeiro fluxo começa aqui.</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Nenhum agente ou exemplo é adicionado automaticamente.
          </p>
          <Button
            className="mt-auto"
            variant="accent"
            disabled={pending}
            onClick={() => {
              if (!busy.current) {
                createdId.current = null;
                void createProject(null);
              }
            }}
          >
            Criar projeto em branco
          </Button>
        </Card>
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            disabled={pending}
            onChoose={choose}
          />
        ))}
      </div>
      {selected && (
        <Modal
          title="Criar projeto a partir de template"
          onClose={() => {
            if (!pending) {
              setSelected(null);
              setError("");
            }
          }}
        >
          <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Configurar template">
            <p className="text-sm text-muted-foreground">
              {selected.name}. O projeto será salvo como rascunho. Revise as configurações no editor
              antes de publicar.
            </p>
            <label className="flex flex-col gap-2 text-sm font-semibold">
              Nome do projeto
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
                required
                disabled={pending}
              />
            </label>
            {selected.requiresWorkdir && (
              <div>
                <label className="flex flex-col gap-2 text-sm font-semibold">
                  Pasta de trabalho no runner
                  <Input
                    value={cwd}
                    onChange={(event) => setCwd(event.target.value)}
                    required
                    disabled={pending}
                    aria-describedby="template-workdir-hint"
                  />
                </label>
                <p id="template-workdir-hint" className="mt-2 text-xs text-muted-foreground">
                  Informe uma pasta absoluta no computador que executará os terminais. Ela será
                  aplicada aos agentes deste projeto.
                </p>
                {window.neuronsDesktop && window.neuronsDesktop.localResources !== false && (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2"
                    disabled={pending}
                    onClick={() =>
                      void window.neuronsDesktop!.chooseDirectory().then((path) => {
                        if (path) setCwd(path);
                      })
                    }
                  >
                    <FolderOpen className="size-4" aria-hidden />
                    Selecionar pasta
                  </Button>
                )}
              </div>
            )}
            {selected.requiresApiKey && (
              <p className="rounded-lg border bg-accent/10 p-3 text-sm">
                Crie os segredos {selected.requiredSecrets.join(" e ")} em Conexões de IA antes de
                executar. O uso de API é cobrado na conta do provedor.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setSelected(null);
                  setError("");
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Criando projeto…" : "Criar projeto com template"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
