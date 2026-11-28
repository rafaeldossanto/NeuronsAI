import { useState, type FormEvent } from "react";
import { Check, KeyRound, Loader2, Monitor, RefreshCw, SquareTerminal, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Modal } from "@/shared/modal";
import { Field, TextInput } from "@/shared/ui/fields";
import { unwrap } from "@/shared/api";
import { useWorkspace } from "@/workspace/resources";

type Provider = "claude" | "chatgpt";

export const ClaudeConnection = () => <SubscriptionConnection provider="claude" />;
export const ChatgptConnection = () => <SubscriptionConnection provider="chatgpt" />;

const CONNECTED: Record<Provider, string> = {
  claude: "Claude Code conectado",
  chatgpt: "ChatGPT conectado",
};
const CONNECT: Record<Provider, string> = {
  claude: "Conectar Claude Code",
  chatgpt: "Conectar ChatGPT",
};

/** Shortest time the check spinner stays up, so an instant answer is still noticed. */
const MIN_CHECK_MS = 400;
type CheckState = "idle" | "checking" | "ok" | "fail";

const CHECK_LABEL: Record<Exclude<CheckState, "idle">, string> = {
  checking: "Verificando conexão…",
  ok: "Conexão confirmada",
  fail: "Não conectado",
};

/** Spinner while checking, then a green check or a red cross. */
function CheckIndicator({ state }: { state: CheckState }) {
  if (state === "idle") return null;
  return (
    <span
      data-testid="connection-check"
      data-state={state}
      role="img"
      aria-label={CHECK_LABEL[state]}
      title={CHECK_LABEL[state]}
      className="inline-flex items-center"
    >
      {state === "checking" && (
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      )}
      {state === "ok" && (
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950">
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
        </span>
      )}
      {state === "fail" && (
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-destructive text-white">
          <X className="size-3.5" strokeWidth={3} aria-hidden />
        </span>
      )}
    </span>
  );
}

/** Status and official login of a subscription that goes through the provider's own CLI. */
function SubscriptionConnection({ provider }: { provider: Provider }) {
  const workspace = useWorkspace();
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [check, setCheck] = useState<CheckState>("idle");
  if (!workspace) return null;
  const { connections, api } = workspace;
  const claude = connections.data?.[provider];
  async function connect() {
    setPending(true);
    setNotice("");
    try {
      await unwrap(
        provider === "claude"
          ? api.POST("/connections/claude/login")
          : api.POST("/connections/chatgpt/login"),
      );
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
  async function verify() {
    setCheck("checking");
    const [result] = await Promise.all([
      connections.refetch(),
      new Promise((resolve) => setTimeout(resolve, MIN_CHECK_MS)),
    ]);
    setCheck(!result.isError && result.data?.[provider]?.connected === true ? "ok" : "fail");
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        <Monitor className="mr-1 inline size-4" />
        {connections.isPending
          ? "Verificando conexão…"
          : (claude?.message ?? "Não foi possível consultar a conexão.")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
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
          {pending ? "Abrindo login…" : claude?.connected ? CONNECTED[provider] : CONNECT[provider]}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void verify()}
          disabled={check === "checking" || connections.isFetching}
        >
          <RefreshCw className="size-4" /> Verificar conexão
        </Button>
        <CheckIndicator state={check} />
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
          <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <SquareTerminal className="size-5" />
            ChatGPT (Codex)
          </h3>
          <ChatgptConnection />
          <p className="mt-3 text-xs text-muted-foreground">
            Usa o Codex oficial, do app do Codex ou do CLI instalado com{" "}
            <code>npm i -g @openai/codex</code>. O login é feito por ele (Sign in with ChatGPT): o
            NeuronsAI não lê nem guarda suas credenciais.
          </p>
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
