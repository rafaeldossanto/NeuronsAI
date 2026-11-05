// Sandboxed Electron preloads must be CommonJS; Node/ESM imports are not available there.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require("electron");
const { contextBridge, ipcRenderer } = electron;

async function accountCommand(action: string, value?: string): Promise<unknown> {
  try {
    return await ipcRenderer.invoke("neurons:account", action, value);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
        : "Não foi possível alterar a conexão do aplicativo.";
    throw new Error(message, { cause: error });
  }
}

// This is the entire renderer bridge: no raw IPC, shell, file read or credential access.
contextBridge.exposeInMainWorld("neuronsDesktop", {
  platform: process.platform,
  localResources: !process.argv.includes("--neurons-desktop-remote"),
  account: {
    getState: () => accountCommand("state"),
    connect: (serverOrigin: string) => accountCommand("connect", serverOrigin),
    signIn: () => accountCommand("login"),
    cancelLogin: () => accountCommand("cancel"),
    openLocal: () => accountCommand("local"),
    forget: () => accountCommand("forget"),
  },
  minimize: () => ipcRenderer.invoke("neurons:window", "minimize"),
  maximize: () => ipcRenderer.invoke("neurons:window", "maximize"),
  close: () => ipcRenderer.invoke("neurons:window", "close"),
  chooseDirectory: () => ipcRenderer.invoke("neurons:directory"),
  isMaximized: () => ipcRenderer.invoke("neurons:window", "state"),
  getUpdateState: () => ipcRenderer.invoke("neurons:update", "state"),
  installUpdate: () => ipcRenderer.invoke("neurons:update", "install"),
  onUpdateState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on("neurons:update-state", listener);
    return () => ipcRenderer.removeListener("neurons:update-state", listener);
  },
  onMaximized: (callback: (maximized: boolean) => void) => {
    const listener = (_event: unknown, maximized: boolean) => callback(maximized);
    ipcRenderer.on("neurons:maximized", listener);
    return () => ipcRenderer.removeListener("neurons:maximized", listener);
  },
});
