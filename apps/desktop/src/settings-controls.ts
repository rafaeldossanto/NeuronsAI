import { BrowserWindow, dialog, ipcMain } from "electron";
import type { DesktopSettingsStore } from "./settings-store.js";
import {
  SettingsError,
  parseTriggersSettings,
  triggersView,
  type AppliedTriggers,
  type TriggersView,
} from "./triggers-settings.js";
import { trustedWindow } from "./window-controls.js";

export interface SettingsControlsOptions {
  store: DesktopSettingsStore;
  /** What the running server was started with. */
  applied: () => AppliedTriggers;
  /** The bundled interface's origin: only it may read or change settings (not a remote server's page). */
  localOrigin: string;
  /** Whether a run is going (asks first) or cannot be told (counts as going). */
  hasActiveRuns: () => Promise<boolean>;
  /** Closes the app and opens it again, so the embedded server starts with the saved settings. */
  relaunch: () => void;
}

/**
 * The narrow bridge of the settings screen: three actions, each validated here, none of them able
 * to name a file, a command or an address. Only the app's own page may call it; anything that is
 * not one of the app's pt-BR refusals reaches the renderer as a generic message.
 */
export function installSettingsControls(options: SettingsControlsOptions): void {
  const view = async (): Promise<TriggersView> =>
    triggersView((await options.store.load()).triggers, options.applied());

  ipcMain.handle("neurons:settings", async (event, action: unknown, value: unknown) => {
    try {
      const window = trustedWindow(event, options.localOrigin);
      switch (action) {
        case "triggers:get":
          return await view();
        case "triggers:set": {
          const triggers = parseTriggersSettings(value);
          await options.store.saveTriggers(triggers);
          return await view();
        }
        case "restart": {
          if (!(await confirmRestart(window, options.hasActiveRuns))) return false;
          options.relaunch();
          return true;
        }
        default:
          throw new SettingsError("Ação desconhecida.");
      }
    } catch (error) {
      if (error instanceof SettingsError) throw error;
      if (
        error instanceof Error &&
        /^(Origem não autorizada|Janela indisponível)/.test(error.message)
      )
        throw error;
      throw new SettingsError("Não foi possível alterar as configurações. Tente novamente.");
    }
  });
}

/** Restarting stops every agent: asks first when a run is going on (or when it cannot be told). */
async function confirmRestart(
  window: BrowserWindow,
  hasActiveRuns: () => Promise<boolean>,
): Promise<boolean> {
  let busy = true;
  try {
    busy = await hasActiveRuns();
  } catch {
    // Unknown counts as busy.
  }
  if (!busy) return true;
  const { response } = await dialog.showMessageBox(window, {
    type: "warning",
    title: "Reiniciar o NeuronsAI",
    message: "Há execuções em andamento.",
    detail:
      "Reiniciar agora interrompe os agentes que estão rodando. Você pode reiniciar depois, quando elas terminarem.",
    buttons: ["Reiniciar agora", "Agora não"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return response === 0;
}
