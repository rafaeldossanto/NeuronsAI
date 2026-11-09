import { BrowserWindow, dialog, ipcMain } from "electron";
import electronUpdater, { type UpdateInfo } from "electron-updater";
import {
  hasActiveRuns,
  isSafeVersion,
  releaseUrl,
  type UpdateMode,
  type UpdateState,
} from "./update-policy.js";
import { trustedWindow, type TrustedOrigin } from "../shell/window-controls.js";

const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

/**
 * Looks for a new version when the app opens and every few hours (GitHub Releases of the public
 * repository, no token). Depending on the system the update is downloaded in the background and
 * the interface offers the restart (`auto`), or the interface only links to the download
 * (`manual`: unsigned macOS, `.deb`). Nothing is ever installed without the user asking, and asking
 * to install while a run is going on asks again, naming the risk.
 */
export function installUpdater(
  origin: TrustedOrigin,
  mode: UpdateMode,
  platform: NodeJS.Platform,
  localOrigin = typeof origin === "function" ? origin() : origin,
): void {
  let state: UpdateState = { kind: "idle" };
  const set = (next: UpdateState) => {
    state = next;
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed()) window.webContents.send("neurons:update-state", state);
  };

  if (mode.kind === "off") {
    ipcMain.handle("neurons:update", (event, action: unknown) => {
      trustedWindow(event, origin);
      if (action === "state") return state;
      if (action !== "install") throw new Error("Ação desconhecida.");
      trustedWindow(event, localOrigin);
    });
    return;
  }

  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = mode.kind === "auto";
  // Installing is always the user's call (the restart button), never a side effect of quitting.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    if (!isSafeVersion(info.version)) return;
    if (mode.kind === "manual")
      set({
        kind: "manual",
        version: info.version,
        url: releaseUrl(info.version),
        reason: mode.reason,
      });
    else set({ kind: "downloading", version: info.version });
  });
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    if (isSafeVersion(info.version)) set({ kind: "ready", version: info.version });
  });
  autoUpdater.on("error", (error: Error) => {
    // Offline, no release yet, rate limit: not worth bothering anyone, the next check retries.
    console.warn(`[updater] ${error.message}`);
    if (state.kind === "downloading") set({ kind: "idle" });
  });

  const check = () => {
    if (state.kind === "ready" || state.kind === "downloading") return;
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      console.warn(`[updater] ${error instanceof Error ? error.message : String(error)}`);
    });
  };
  setTimeout(check, FIRST_CHECK_MS).unref();
  setInterval(check, CHECK_EVERY_MS).unref();

  ipcMain.handle("neurons:update", async (event, action: unknown) => {
    const window = trustedWindow(event, origin);
    switch (action) {
      case "state":
        return state;
      case "install": {
        trustedWindow(event, localOrigin);
        if (state.kind !== "ready" || mode.kind !== "auto") return;
        if (await confirmRestart(window, localOrigin)) {
          // On Linux the new AppImage is not started by the updater: the single-instance lock
          // would still be held by this process while it shuts down.
          autoUpdater.quitAndInstall(true, platform !== "linux");
        }
        return;
      }
      default:
        throw new Error("Ação desconhecida.");
    }
  });
}

/** Asks first when a run is going on (or when it cannot be told); otherwise the click was the ask. */
async function confirmRestart(window: BrowserWindow, origin: string): Promise<boolean> {
  let busy = true;
  try {
    busy = await hasActiveRuns(origin);
  } catch {
    // Unknown counts as busy.
  }
  if (!busy) return true;
  const { response } = await dialog.showMessageBox(window, {
    type: "warning",
    title: "Atualizar o NeuronsAI",
    message: "Há execuções em andamento.",
    detail:
      "Reiniciar agora para atualizar interrompe os agentes que estão rodando. Você pode atualizar depois, quando elas terminarem.",
    buttons: ["Reiniciar e atualizar", "Agora não"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return response === 0;
}
