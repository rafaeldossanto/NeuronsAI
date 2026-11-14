import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { ApiClient } from "@neurons/api-client";
import { Button } from "@/shared/ui/button";
import { LoadingRows } from "@/shared/states";
import { ApiError, expectNoContent, unwrap } from "@/shared/api";
import { SessionContext, type AccountSession } from "./session-context";
import { invalidateWorkspaceRequests } from "./session-fetch";

const SIGNUP_CLOSED_MESSAGE =
  "Acesso só por convite. Peça a um administrador da sua organização para convidar o seu e-mail e entre de novo.";

/** The server sends a Google account that is not invited back with `?login_error=signup_closed`. */
function takeLoginError(): string {
  try {
    const url = new URL(window.location.href);
    const reason = url.searchParams.get("login_error");
    if (reason === null) return "";
    url.searchParams.delete("login_error");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    return reason === "signup_closed"
      ? SIGNUP_CLOSED_MESSAGE
      : "Não foi possível concluir o login.";
  } catch {
    return "";
  }
}

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
  const [error, setError] = useState(takeLoginError);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [account, setAccount] = useState<AccountSession | null>(null);
  const checkVersion = useRef(0);
  const changingScope = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const check = useCallback(async () => {
    const version = ++checkVersion.current;
    try {
      const session = await unwrap(api.GET("/auth/session"));
      if (version !== checkVersion.current) return;
      if (!session.enabled) {
        setAccount(null);
        setStatus("local");
      } else if (
        session.authenticated &&
        session.userId &&
        session.organizationId &&
        session.role
      ) {
        setAccount({
          userId: session.userId,
          organizationId: session.organizationId,
          role: session.role,
        });
        setStatus("authenticated");
      } else {
        setAccount(null);
        setStatus("login");
      }
    } catch (failure) {
      if (version !== checkVersion.current) return;
      setAccount(null);
      if (failure instanceof ApiError && failure.code === "invalid_session") setStatus("login");
      else {
        setError(
          failure instanceof Error ? failure.message : "Não foi possível verificar a sessão.",
        );
        setStatus("failed");
      }
    }
  }, [api]);
  useEffect(() => {
    let disposed = false;
    const ended = () => {
      if (!disposed) {
        checkVersion.current++;
        setAccount(null);
        setStatus("login");
        setError("");
      }
    };
    window.addEventListener("neurons:session-ended", ended);
    const changed = () => {
      checkVersion.current++;
      changingScope.current = true;
      setStatus("checking");
      void invalidateWorkspaceRequests()
        .then(check)
        .finally(() => {
          changingScope.current = false;
        });
    };
    const focus = () => {
      if (!changingScope.current) void check();
    };
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("neurons-session");
      channel.current.onmessage = changed;
    }
    window.addEventListener("focus", focus);
    window.addEventListener("neurons:session-changed", changed);
    queueMicrotask(() => {
      if (!disposed) void check();
    });
    const timer = window.setInterval(focus, 5 * 60_000);
    return () => {
      disposed = true;
      // This is a request generation counter, not a DOM ref captured by the effect.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      checkVersion.current++;
      channel.current?.close();
      channel.current = null;
      window.clearInterval(timer);
      window.removeEventListener("neurons:session-ended", ended);
      window.removeEventListener("focus", focus);
      window.removeEventListener("neurons:session-changed", changed);
    };
  }, [check, attempt]);

  const switchOrganization = useCallback(
    async (organizationId: string) => {
      changingScope.current = true;
      checkVersion.current++;
      flushSync(() => setStatus("checking"));
      await invalidateWorkspaceRequests();
      try {
        await expectNoContent(api.POST("/auth/organization", { body: { organizationId } }));
        setError("");
        channel.current?.postMessage("changed");
        await check();
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : "Não foi possível mudar de organização.",
        );
        setStatus("failed");
      } finally {
        changingScope.current = false;
      }
    },
    [api, check],
  );
  const sessionValue = useMemo(
    () => (account ? { account, reload: check, switchOrganization } : null),
    [account, check, switchOrganization],
  );

  async function signIn() {
    setBusy(true);
    setError("");
    try {
      if (window.neuronsDesktop?.account) {
        await window.neuronsDesktop.account.signIn();
        return;
      }
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
      setAccount(null);
      channel.current?.postMessage("changed");
      await invalidateWorkspaceRequests();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível sair.");
    } finally {
      setBusy(false);
    }
  }
  if (status === "local") return children;
  // `switchOrganization` touches refs only when called (from an event), never while rendering.
  // eslint-disable-next-line react-hooks/refs
  if (status === "authenticated" && account && sessionValue)
    return (
      <SessionContext.Provider value={sessionValue}>
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
        <div key={`${account.userId}:${account.organizationId}:${account.role}`}>{children}</div>
      </SessionContext.Provider>
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
            {status === "checking"
              ? "Abrindo seu espaço"
              : status === "failed"
                ? "Não foi possível abrir seu espaço"
                : "Entre no seu espaço"}
          </h1>
          <p className="body-6 text-muted-foreground">
            {status === "failed"
              ? "Confira se o servidor do NeuronsAI está em execução e se a rede está funcionando; depois tente de novo."
              : "Acesse seus projetos e acompanhe seus agentes em um só lugar."}
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
              <>
                <Button variant="accent" onClick={() => void signIn()} disabled={busy}>
                  {busy
                    ? window.neuronsDesktop?.account
                      ? "Conclua a entrada no navegador…"
                      : "Abrindo login…"
                    : "Entrar com Google"}
                </Button>
                {busy && window.neuronsDesktop?.account && (
                  <Button
                    variant="outline"
                    onClick={() => void window.neuronsDesktop?.account?.cancelLogin()}
                  >
                    Cancelar entrada
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
