import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";

/** The window behind an IPC call, only if the call comes from the app's own page (main frame). */
export type TrustedOrigin = string | (() => string);
export function trustedWindow(event: IpcMainInvokeEvent, origin: TrustedOrigin): BrowserWindow {
  if (
    !event.senderFrame ||
    new URL(event.senderFrame.url).origin !== (typeof origin === "function" ? origin() : origin) ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw new Error("Origem não autorizada.");
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) throw new Error("Janela indisponível.");
  return window;
}

/** Bind once, validate both origin and window identity before granting a narrow native action. */
export function installWindowControls(
  origin: TrustedOrigin,
  localOrigin = typeof origin === "function" ? origin() : origin,
): void {
  const target = (event: IpcMainInvokeEvent) => trustedWindow(event, origin);
  ipcMain.handle("neurons:window", (event, action: unknown) => {
    const window = target(event);
    switch (action) {
      case "state":
        return window.isMaximized();
      case "minimize":
        window.minimize();
        break;
      case "maximize":
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
        break;
      case "close":
        window.close();
        break;
      default:
        throw new Error("Ação desconhecida.");
    }
  });
  ipcMain.handle("neurons:directory", async (event) => {
    // Remote pages cannot request local filesystem paths through the preload.
    trustedWindow(event, localOrigin);
    const result = await dialog.showOpenDialog(target(event), {
      properties: ["openDirectory"],
      title: "Selecionar pasta",
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}
