// Sandboxed Electron preloads must be CommonJS; Node/ESM imports are not available there.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require("electron");
const { contextBridge, ipcRenderer } = electron;

// This is the entire renderer bridge: no raw IPC, shell, file read or credential access.
contextBridge.exposeInMainWorld("neuronsDesktop", {
  platform: process.platform,
  minimize: () => ipcRenderer.invoke("neurons:window", "minimize"),
  maximize: () => ipcRenderer.invoke("neurons:window", "maximize"),
  close: () => ipcRenderer.invoke("neurons:window", "close"),
  chooseDirectory: () => ipcRenderer.invoke("neurons:directory"),
  isMaximized: () => ipcRenderer.invoke("neurons:window", "state"),
  onMaximized: (callback: (maximized: boolean) => void) => {
    const listener = (_event: unknown, maximized: boolean) => callback(maximized);
    ipcRenderer.on("neurons:maximized", listener);
    return () => ipcRenderer.removeListener("neurons:maximized", listener);
  },
});
