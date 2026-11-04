import { useEffect, useState } from "react";

/** What the desktop app says about updates (mirrors `UpdateState` in apps/desktop/src/update-policy.ts). */
export type DesktopUpdateState =
  | { kind: "idle" }
  | { kind: "downloading"; version: string }
  | { kind: "ready"; version: string }
  | { kind: "manual"; version: string; url: string; reason: "mac" | "deb" };

export interface DesktopUpdates {
  getUpdateState(): Promise<DesktopUpdateState>;
  installUpdate(): Promise<void>;
  onUpdateState(callback: (state: DesktopUpdateState) => void): () => void;
}

const MANUAL_REASON = {
  mac: "A atualização automática no macOS depende da assinatura do app.",
  deb: "O pacote .deb não se atualiza sozinho.",
} as const;

/** A thin bar under the title bar: only shown when there is something to do about an update. */
export function UpdateNotice({ updates }: { updates: DesktopUpdates }) {
  const [state, setState] = useState<DesktopUpdateState>({ kind: "idle" });
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    void updates
      .getUpdateState()
      .then(setState)
      .catch(() => undefined);
    return updates.onUpdateState(setState);
  }, [updates]);

  if ((state.kind !== "ready" && state.kind !== "manual") || dismissed === state.version)
    return null;
  return (
    <div className="update-notice" role="status">
      {state.kind === "ready" ? (
        <>
          <span>Nova versão pronta ({state.version}). Reiniciar para atualizar.</span>
          <button type="button" onClick={() => void updates.installUpdate()}>
            Reiniciar para atualizar
          </button>
        </>
      ) : (
        <>
          <span>
            Nova versão disponível ({state.version}): baixe a nova versão.{" "}
            {MANUAL_REASON[state.reason]}
          </span>
          <a href={state.url} target="_blank" rel="noreferrer">
            Baixar a nova versão
          </a>
        </>
      )}
      <button
        type="button"
        className="update-notice-dismiss"
        onClick={() => setDismissed(state.version)}
      >
        Depois
      </button>
    </div>
  );
}
