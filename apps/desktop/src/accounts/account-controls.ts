import { ipcMain, type BrowserWindow } from "electron";
import type { DesktopAccountManager } from "./account-manager.js";
import { trustedWindow } from "../shell/window-controls.js";

/** A narrow bridge. Only the local bundled UI may change or forget the configured server. */
export function installAccountControls(
  manager: DesktopAccountManager,
  localOrigin: string,
  currentOrigin: () => string,
  currentWindow: () => BrowserWindow | undefined,
): void {
  ipcMain.handle("neurons:account", async (event, action: unknown, value: unknown) => {
    try {
      const target = trustedWindow(event, currentOrigin);
      if (target !== currentWindow()) throw new Error("Janela não autorizada.");
      switch (action) {
        case "state":
          return manager.state();
        case "login":
          await manager.signIn();
          return;
        case "cancel":
          manager.cancelLogin();
          return;
        case "local":
          await manager.openLocal();
          return;
        case "connect":
        case "forget": {
          trustedWindow(event, localOrigin);
          if (action === "forget") await manager.forget();
          else {
            if (typeof value !== "string" || value.length > 2048)
              throw new Error("Endereço de servidor inválido.");
            await manager.connect(value);
          }
          return;
        }
        default:
          throw new Error("Ação desconhecida.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        /^(Informe a origem|Este é o endereço|O servidor precisa|Entre novamente|Não foi possível|Já existe|Entrada cancelada|A entrada|O armazenamento protegido|Abra um servidor|A conexão mudou|Origem não autorizada|Janela não autorizada|Endereço de servidor inválido|Ação desconhecida)/.test(
          message,
        )
      )
        throw error;
      // Native/transport exceptions may include cookie values. Keep them out of the renderer.
      // eslint-disable-next-line preserve-caught-error
      throw new Error("Não foi possível alterar a conexão do aplicativo. Tente novamente.");
    }
  });
}
