import { useEffect, useState, type ReactNode } from "react";
import { UpdateNotice, type DesktopUpdates } from "@/components/update-notice";

declare global {
  interface Window {
    neuronsDesktop?: DesktopUpdates & {
      platform: string;
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
  return (
    <div className={`desktop-frame${maximized ? " is-maximized" : ""}`}>
      <div className="desktop-titlebar" onDoubleClick={() => void desktop.maximize()}>
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
      </div>
      <UpdateNotice updates={desktop} />
      <div className="desktop-content">{children}</div>
    </div>
  );
}
