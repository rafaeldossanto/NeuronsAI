/** What the desktop app tells the settings screen about the external triggers (webhooks). */
export interface DesktopTriggersView {
  /** The saved choice. */
  enabled: boolean;
  port: number;
  /** `NEURONS_HOOKS_PORT` is set in the environment: it decides, and the screen cannot change it. */
  environment: boolean;
  /** Where the webhook port answers now, or null while it is off. */
  address: string | null;
  /** The saved choice is not what is running: the embedded server must restart. */
  restartRequired: boolean;
  /** Why the choice is not running although it was asked for, if there is a reason. */
  problem: string | null;
}

/** The settings bridge of the desktop app's preload (`window.neuronsDesktop.settings`). */
export interface DesktopSettingsBridge {
  getTriggers(): Promise<DesktopTriggersView>;
  setTriggers(value: { enabled: boolean; port: number }): Promise<DesktopTriggersView>;
  /** Restarts the app (asks first when a run is going on). Resolves false if the person declined. */
  restart(): Promise<boolean>;
}

/** The settings screen exists only in the desktop app's own interface, never for a remote server. */
export function desktopSettings(): DesktopSettingsBridge | undefined {
  const desktop = window.neuronsDesktop;
  return desktop && desktop.localResources !== false ? desktop.settings : undefined;
}

/** Where the Cloudflare Tunnel setup is explained (section "Túnel" of the server's README). */
export const TUNNEL_DOCS_URL =
  "https://github.com/rafaeldossanto/NeuronsAI/blob/main/apps/server/README.md#t%C3%BAnel-cloudflare-tunnel";

export const DEFAULT_TRIGGERS_PORT = 3101;
export const MIN_TRIGGERS_PORT = 1024;
export const MAX_TRIGGERS_PORT = 65_535;
