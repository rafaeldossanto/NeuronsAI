import { ipcMain } from "electron";
import { trustedWindow } from "../shell/window-controls.js";
import type { AvatarStore } from "./avatar-store.js";

export function installAvatarControls(store: AvatarStore, localOrigin: string): void {
  ipcMain.handle("neurons:avatar", async (event, action: unknown, value: unknown) => {
    // Remote pages cannot read or overwrite the local profile image.
    trustedWindow(event, localOrigin);
    try {
      if (action === "read") return await store.load();
      if (action === "write") return await store.save(value);
      throw new Error("Ação desconhecida.");
    } catch {
      throw new Error("Não foi possível salvar a imagem do perfil.");
    }
  });
}
