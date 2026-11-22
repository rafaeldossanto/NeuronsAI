import { useEffect, useState, type ReactNode } from "react";
import { UpdateNotice, type DesktopUpdates } from "@/updates/update-notice";
import { DesktopAccount, type DesktopAccountBridge } from "@/accounts/desktop-account";
import type { DesktopSettingsBridge } from "@/settings/desktop-settings";
import "./desktop-frame.css";

declare global {
  interface Window {
    neuronsDesktop?: DesktopUpdates & {
      platform: string;
      localResources?: boolean;
      avatar?: {
        read(): Promise<string | null>;
        write(image: string): Promise<void>;
      };
      account?: DesktopAccountBridge;
      settings?: DesktopSettingsBridge;
      minimize(): Promise<void>;
      maximize(): Promise<void>;
      close(): Promise<void>;
      chooseDirectory(): Promise<string | null>;
      isMaximized(): Promise<boolean>;
      onMaximized(callback: (maximized: boolean) => void): () => void;
    };
  }
}

export function DesktopFrame({ children }: { children: ReactNode }) {
  const desktop = window.neuronsDesktop;
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    document.documentElement.classList.add("desktop-root");
    void desktop.isMaximized().then(setMaximized);
    return desktop.onMaximized(setMaximized);
  }, [desktop]);
  if (!desktop) return children;
  const windows = desktop.platform === "win32";
  const frame = (
    <div className={`desktop-frame${maximized ? " is-maximized" : ""}`}>
      <div
        className={`desktop-titlebar${windows ? " desktop-titlebar-windows" : ""}`}
        onDoubleClick={() => void desktop.maximize()}
      >
        {windows ? (
          <>
            <span>NeuronsAI</span>
            <div className="desktop-window-controls">
              <button
                className="window-minimize"
                aria-label="Minimizar janela"
                title="Minimizar"
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={() => void desktop.minimize()}
              >
                <svg viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M0 5.5h10" />
                </svg>
              </button>
              <button
                className="window-maximize"
                aria-label={maximized ? "Restaurar janela" : "Maximizar janela"}
                title={maximized ? "Restaurar" : "Maximizar"}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={() => void desktop.maximize()}
              >
                <svg viewBox="0 0 10 10" aria-hidden="true">
                  {maximized ? (
                    <path d="M2.5 2.5v-2h7v7h-2M0.5 2.5h7v7h-7z" />
                  ) : (
                    <path d="M0.5 0.5h9v9h-9z" />
                  )}
                </svg>
              </button>
              <button
                className="window-close"
                aria-label="Fechar janela"
                title="Fechar"
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={() => void desktop.close()}
              >
                <svg viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M0 0l10 10M10 0L0 10" />
                </svg>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="desktop-traffic-lights">
              <button
                className="window-close"
                aria-label="Fechar janela"
                title="Fechar"
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={() => void desktop.close()}
              >
                ×
              </button>
              <button
                className="window-minimize"
                aria-label="Minimizar janela"
                title="Minimizar"
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={() => void desktop.minimize()}
              >
                −
              </button>
              <button
                className="window-maximize"
                aria-label="Maximizar ou restaurar janela"
                title="Maximizar ou restaurar"
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={() => void desktop.maximize()}
              >
                ↗
              </button>
            </div>
            <span>NeuronsAI</span>
          </>
        )}
      </div>
      {desktop.localResources !== false && <UpdateNotice updates={desktop} />}
      <div className="desktop-content">{children}</div>
    </div>
  );
  return desktop.account ? (
    <DesktopAccount account={desktop.account}>{frame}</DesktopAccount>
  ) : (
    frame
  );
}
