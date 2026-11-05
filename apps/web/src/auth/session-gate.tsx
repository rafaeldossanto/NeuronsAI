import { useEffect, useState, type ReactNode } from "react";
import type { ApiClient } from "@neurons/api-client";
import { Button } from "@/components/ui/button";
import { LoadingRows } from "@/components/states";
import { ApiError, unwrap } from "@/lib/api";

type Status = "checking" | "local" | "authenticated" | "login" | "failed";
/** Production shell. The local app discovers that accounts are off and renders the same workspace. */
export function SessionGate({
  api,
  children,
  navigate = (url) => location.assign(url),
}: {
  api: ApiClient;
  children: ReactNode;
  navigate?: (url: string) => void;
}) {
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    const check = async () => {
      try {
        const session = await unwrap(api.GET("/auth/session"));
        if (!disposed)
          setStatus(!session.enabled ? "local" : session.authenticated ? "authenticated" : "login");
      } catch (failure) {
        if (disposed) return;
        if (failure instanceof ApiError && failure.code === "invalid_session") setStatus("login");
        else {
          setError(
            failure instanceof Error ? failure.message : "Não foi possível verificar a sessão.",
          );
          setStatus("failed");
        }
      }
    };
    const ended = () => {
      if (!disposed) {
        setStatus("login");
        setError("");
      }
    };
    window.addEventListener("neurons:session-ended", ended);
    void check();
    const timer = window.setInterval(() => void check(), 5 * 60_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("neurons:session-ended", ended);
    };
  }, [api, attempt]);

  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const { authorizationUrl } = await unwrap(api.POST("/auth/google"));
      const url = new URL(authorizationUrl);
      if (url.origin !== "https://accounts.google.com")
        throw new Error("O servidor retornou um endereço de login inválido.");
      navigate(url.href);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível iniciar o login.");
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const result = await api.POST("/auth/logout");
      if (result.response.status !== 204)
        throw new Error("Não foi possível encerrar a sessão. Tente novamente.");
      setStatus("login");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível sair.");
    } finally {
      setBusy(false);
    }
  }
  if (status === "local") return children;
  if (status === "authenticated")
    return (
      <>
        <div className="flex items-center justify-end gap-4 bg-muted px-6 py-2">
          {error && (
            <p role="alert" className="body-6 text-destructive">
              {error}
            </p>
          )}
          <Button size="sm" variant="outline" onClick={() => void signOut()} disabled={busy}>
            Sair da conta
          </Button>
        </div>
        {children}
      </>
    );
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section
        className="flex w-full max-w-md flex-col gap-6 rounded-lg bg-card p-8"
        aria-label="Acesso ao NeuronsAI"
      >
        <div className="flex flex-col gap-3">
          <p className="caption-4 text-muted-foreground">NeuronsAI</p>
          <h1 className="heading-5">
            {status === "checking" ? "Abrindo seu espaço" : "Entre no seu espaço"}
          </h1>
          <p className="body-6 text-muted-foreground">
            Acesse seus projetos e acompanhe seus agentes em um só lugar.
          </p>
        </div>
        {status === "checking" ? (
          <LoadingRows rows={2} label="Verificando sessão" />
        ) : (
          <>
            {error && (
              <p role="alert" className="body-6 text-destructive">
                {error}
              </p>
            )}
            {status === "failed" ? (
              <Button
                variant="outline"
                onClick={() => {
                  setStatus("checking");
                  setAttempt((value) => value + 1);
                }}
              >
                Tentar novamente
              </Button>
            ) : (
              <Button variant="accent" onClick={() => void signIn()} disabled={busy}>
                {busy ? "Abrindo login…" : "Entrar com Google"}
              </Button>
            )}
          </>
        )}
      </section>
    </main>
  );
}
