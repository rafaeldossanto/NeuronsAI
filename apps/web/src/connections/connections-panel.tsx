import { useState, type FormEvent } from "react";
import { KeyRound, Monitor, RefreshCw, SquareTerminal } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Modal } from "@/shared/modal";
import { Field, TextInput } from "@/shared/ui/fields";
import { unwrap } from "@/shared/api";
import { useWorkspace } from "@/workspace/resources";

export function ClaudeConnection() {
  const workspace = useWorkspace();
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  if (!workspace) return null;
  const { connections, api } = workspace;
  const claude = connections.data?.claude;
  async function connect() {
    setPending(true);
    setNotice("");
    try {
      await unwrap(api.POST("/connections/claude/login"));
      setNotice(
        "Conclua o login na página oficial que abrirá no navegador e clique em Verificar conexão.",
      );
      await connections.refetch();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível iniciar o login.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        <Monitor className="mr-1 inline size-4" />
        {connections.isPending
          ? "Verificando conexão…"
          : (claude?.message ?? "Não foi possível consultar a conexão.")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => void connect()}
          disabled={
            pending ||
            !claude?.installed ||
            claude.connected ||
            connections.data?.profile !== "local"
          }
        >
          {pending
            ? "Abrindo login…"
            : claude?.connected
              ? "Claude Code conectado"
              : "Conectar Claude Code"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void connections.refetch()}
          disabled={connections.isFetching}
        >
          <RefreshCw className="size-4" /> Verificar conexão
        </Button>
      </div>
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}

export function ConnectionsPanel({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspace()!;
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setSaved(false);
    try {
      const result = await workspace.api.PUT("/secrets/{name}", {
        params: { path: { name } },
        body: { value },
      });
      if (!result.response.ok)
        throw new Error(
          (result.error as { message?: string })?.message ?? "Não foi possível salvar a chave.",
        );
      setValue("");
      setName("");
      setMessage("Chave salva. Selecione o nome nas propriedades do agente.");
      setSaved(true);
      await workspace.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao salvar a chave.");
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal title="Conexões de IA" onClose={onClose}>
      <div className="flex flex-col gap-6">
        <section className="resource-card">
          <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <SquareTerminal className="size-5" />
            Claude Code
          </h3>
          <ClaudeConnection />
        </section>
        <section className="resource-card">
          <h3 className="mb-2 text-lg font-semibold">
            ChatGPT <span className="ml-2 rounded bg-muted px-2 py-1 text-xs">Em breve</span>
          </h3>
          <p className="text-sm text-muted-foreground">
            {workspace.connections.data?.chatgpt.message ??
              "Integração oficial de assinatura ainda não disponível."}
          </p>
          <Button className="mt-3" variant="outline" disabled>
            Conectar ChatGPT
          </Button>
        </section>
        <section className="resource-card">
          <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <KeyRound className="size-5" />
            Chaves de API
          </h3>
          <p className="mb-3 text-sm text-muted-foreground">
            Cobrança por uso na conta do provedor. A chave é armazenada cifrada; apenas o nome fica
            disponível para seleção.
          </p>
          {workspace.secrets.data && workspace.secrets.data.length > 0 && (
            <p className="mb-3 text-sm">Salvas: {workspace.secrets.data.join(", ")}</p>
          )}
          {workspace.connections.data && !workspace.connections.data.secretsEnabled && (
            <p role="status" className="mb-3 text-sm text-destructive">
              O servidor precisa de NEURONS_MASTER_KEY para proteger as chaves. No desktop, o cofre
              do sistema é configurado automaticamente quando disponível.
            </p>
          )}
          <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3">
            <Field label="Nome da chave">
              <TextInput
                required
                pattern="[A-Za-z0-9._-]{1,128}"
                placeholder="openai-pessoal"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Chave de API">
              <TextInput
                required
                type="password"
                autoComplete="off"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={pending || !workspace.connections.data?.secretsEnabled}>
              {pending ? "Salvando…" : "Adicionar chave de API"}
            </Button>
          </form>
          {message && (
            <p
              role={saved ? "status" : "alert"}
              className={saved ? "mt-3 text-sm" : "mt-3 text-sm text-destructive"}
            >
              {message}
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}
