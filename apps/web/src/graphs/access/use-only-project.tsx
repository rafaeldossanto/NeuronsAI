import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Play } from "lucide-react";
import { GraphViewer } from "@/graphs/editor/graph-viewer";
import { unwrap, useApi } from "@/shared/api";
import { Modal } from "@/shared/modal";
import { EmptyState, ErrorState } from "@/shared/states";
import { Button } from "@/shared/ui/button";
import { Field, Select, TextArea } from "@/shared/ui/fields";
import { Skeleton } from "@/shared/ui/skeleton";
import { useGraphVersion } from "./queries";

/**
 * What a person who may only use a project sees: the latest published version as a read-only
 * drawing (never the draft), a button to run it and a way to their own runs. Nothing here edits
 * the project; the server refuses it anyway.
 */
export function UseOnlyProject({
  graph,
}: {
  graph: { id: string; name: string; latestVersion: number | null };
}) {
  const version = useGraphVersion(graph.id, graph.latestVersion);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  if (graph.latestVersion === null) {
    return (
      <EmptyState
        title="Este projeto ainda não tem versão publicada"
        hint="Peça a quem edita o projeto para publicar uma versão; depois você poderá executá-la."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 basis-64 text-sm text-muted-foreground">
          Você pode usar este projeto: executar a versão {graph.latestVersion} e acompanhar as suas
          execuções. O desenho é só para leitura.
        </p>
        <Button variant="outline" asChild>
          <Link to="/runs">Minhas execuções</Link>
        </Button>
        <Button disabled={!version.isSuccess} onClick={() => setRunning(true)}>
          <Play className="size-4" aria-hidden="true" /> Executar
        </Button>
      </div>

      <div className="h-[420px] overflow-hidden rounded-lg border bg-background">
        {version.isSuccess ? (
          <GraphViewer
            doc={version.data.definition}
            live={{}}
            pulses={{}}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        ) : version.isError ? (
          <ErrorState error={version.error} onRetry={() => void version.refetch()} />
        ) : (
          <Skeleton
            role="status"
            aria-label="Carregando o desenho"
            className="h-full w-full rounded-none"
          />
        )}
      </div>

      {running && version.isSuccess && (
        <RunDialog
          versionId={version.data.id}
          triggers={version.data.definition.nodes
            .filter((node) => node.type === "trigger")
            .map((node) => node.id)}
          onClose={() => setRunning(false)}
        />
      )}
    </div>
  );
}

function RunDialog({
  versionId,
  triggers,
  onClose,
}: {
  versionId: string;
  triggers: string[];
  onClose: () => void;
}) {
  const api = useApi();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [trigger, setTrigger] = useState(triggers[0] ?? "");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const run = await unwrap(
        api.POST("/runs", {
          body: { graphVersionId: versionId, input, ...(trigger && { triggerId: trigger }) },
        }),
      );
      await navigate(`/runs/${run.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível iniciar a execução.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Modal
      title="Executar projeto"
      onClose={() => {
        if (!starting) onClose();
      }}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <p className="text-sm text-muted-foreground">
          Roda a versão publicada, com as chaves de API da organização. Você vê só as execuções que
          você mesmo iniciar.
        </p>
        {triggers.length > 1 && (
          <Field label="Gatilho inicial">
            <Select value={trigger} onChange={(event) => setTrigger(event.target.value)}>
              {triggers.map((id) => (
                <option value={id} key={id}>
                  {id}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Pedido para os agentes">
          <TextArea
            required
            maxLength={100000}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Descreva o que este time deve fazer"
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={starting || !input.trim()}>
          {starting ? "Iniciando…" : "Iniciar execução"}
        </Button>
      </form>
    </Modal>
  );
}
