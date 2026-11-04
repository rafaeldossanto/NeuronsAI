import type { AgentNode } from "@neurons/graph-schema";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/editor/fields";
import type { FieldPath } from "@/editor/model";
import { useWorkspace } from "./resources";
import { ClaudeConnection } from "./connections-panel";

export function AgentAccess({
  node,
  set,
}: {
  node: AgentNode;
  set: (path: FieldPath, value: unknown) => void;
}) {
  const workspace = useWorkspace();
  const runtime = node.runtime;
  const mode = runtime.access ?? (runtime.kind === "terminal" ? "subscription" : "api-key");
  const terminal = runtime.kind === "terminal";
  const supportedSubscription = terminal && runtime.cli === "claude";
  const supportedAccess = !terminal || supportedSubscription;
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-background p-3">
      <h3 className="text-sm font-semibold">Acesso à IA</h3>
      <div className="access-switch" role="group" aria-label="Acesso à IA">
        <button
          type="button"
          aria-pressed={mode === "subscription"}
          disabled={!supportedSubscription}
          onClick={() => set(["runtime", "access"], "subscription")}
        >
          Assinatura
        </button>
        <button
          type="button"
          aria-pressed={mode === "api-key"}
          disabled={!supportedAccess}
          onClick={() => set(["runtime", "access"], "api-key")}
        >
          Chave de API
        </button>
      </div>
      {!supportedAccess ? (
        <p className="text-xs text-muted-foreground">
          A conexão desta CLI ainda não está implementada. Use Claude Code ou um agente de API.
        </p>
      ) : mode === "subscription" ? (
        <ClaudeConnection />
      ) : (
        <>
          <Field label="Chave de API" hint="Cobrança por uso na conta do provedor.">
            <Select
              value={runtime.secretName ?? ""}
              onChange={(event) => set(["runtime", "secretName"], event.target.value || undefined)}
            >
              <option value="">Selecionar chave salva</option>
              {(workspace?.secrets.data ?? []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              {runtime.secretName && !workspace?.secrets.data?.includes(runtime.secretName) && (
                <option value={runtime.secretName}>{runtime.secretName}</option>
              )}
            </Select>
          </Field>
          <Button variant="outline" size="sm" onClick={() => workspace?.openConnections()}>
            Adicionar chave de API
          </Button>
        </>
      )}
      {!supportedSubscription && (
        <p className="text-xs text-muted-foreground">
          Assinaturas só aparecem quando a integração oficial está disponível. A assinatura do
          ChatGPT ainda não está integrada.
        </p>
      )}
      {workspace?.secrets.isError && mode === "api-key" && (
        <p role="alert" className="text-xs text-destructive">
          Não foi possível carregar as chaves salvas.
        </p>
      )}
    </section>
  );
}
