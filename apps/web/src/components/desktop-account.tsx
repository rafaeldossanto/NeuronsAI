import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "./modal";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export interface DesktopAccountState {
  mode: "local" | "remote";
  serverOrigin: string | null;
  error?: string;
}
export interface DesktopAccountBridge {
  getState: () => Promise<DesktopAccountState>;
  connect: (serverOrigin: string) => Promise<void>;
  signIn: () => Promise<void>;
  cancelLogin: () => Promise<void>;
  openLocal: () => Promise<void>;
  forget: () => Promise<void>;
}

export function DesktopAccount({ account }: { account: DesktopAccountBridge }) {
  const [state, setState] = useState<DesktopAccountState | null>(null);
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void account.getState().then(
      (value) => {
        if (active) {
          setState(value);
          setOrigin(value.serverOrigin ?? "");
          setError(value.error ?? "");
        }
      },
      () => {
        if (active) setError("Não foi possível consultar a conexão do aplicativo.");
      },
    );
    return () => {
      active = false;
    };
  }, [account]);
  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await account.connect(origin.trim());
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível abrir o servidor.");
    } finally {
      setBusy(false);
    }
  }
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setState(await account.getState());
      setOpen(false);
    } catch {
      setError("Não foi possível alterar a conexão. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-2"
        aria-label="Conexão do aplicativo"
      >
        <p className="caption-4 min-w-0 break-all text-muted-foreground">
          {state?.mode === "remote" ? state.serverOrigin : "Espaço local"}
        </p>
        {state?.mode === "remote" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void act(() => account.openLocal())}
          >
            Voltar ao local
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Conectar servidor
          </Button>
        )}
        {error && !open && (
          <p role="alert" className="body-6 w-full text-destructive">
            {error}
          </p>
        )}
      </div>
      {open && (
        <Modal
          title="Conectar servidor"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form className="flex flex-col gap-6" onSubmit={(event) => void connect(event)}>
            <p className="body-6 text-muted-foreground">
              Abra o espaço da sua organização. Seus projetos locais continuam disponíveis ao voltar
              para este computador.
            </p>
            <label className="title-4 flex flex-col gap-2">
              Endereço do servidor
              <Input
                type="url"
                placeholder="https://neurons.exemplo.com"
                value={origin}
                onChange={(event) => setOrigin(event.target.value)}
                required
                disabled={busy}
                autoComplete="url"
              />
            </label>
            <p className="caption-4 text-muted-foreground">
              Informe apenas o endereço principal. A entrada com Google será feita no navegador do
              sistema.
            </p>
            {error && (
              <p role="alert" className="body-6 text-destructive">
                {error}
              </p>
            )}
            <Button disabled={busy || !origin.trim()}>
              {busy ? "Abrindo servidor…" : "Abrir servidor"}
            </Button>
            {state?.serverOrigin && (
              <Button
                variant="ghost"
                type="button"
                disabled={busy}
                onClick={() => void act(() => account.forget())}
              >
                Esquecer sessão salva
              </Button>
            )}
          </form>
        </Modal>
      )}
    </>
  );
}
