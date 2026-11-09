import type { IpcMainInvokeEvent } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  handle: vi.fn(),
  window: { isDestroyed: () => false, webContents: { send: vi.fn() } },
  showMessageBox: vi.fn(),
  events: new Map<string, (value: unknown) => void>(),
  quitAndInstall: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: { handle: native.handle },
  BrowserWindow: { fromWebContents: () => native.window, getAllWindows: () => [native.window] },
  dialog: { showMessageBox: native.showMessageBox },
}));
vi.mock("electron-updater", () => ({
  default: {
    autoUpdater: {
      on: (name: string, callback: (value: unknown) => void) => {
        native.events.set(name, callback);
      },
      checkForUpdates: () => Promise.resolve(),
      quitAndInstall: native.quitAndInstall,
    },
  },
}));
const { installUpdater } = await import("./updater.js");
const local = "http://127.0.0.1:41000",
  remote = "https://neurons.example.invalid";
const event = () => {
  const frame = { url: `${remote}/graphs` };
  return { senderFrame: frame, sender: { mainFrame: frame } } as unknown as IpcMainInvokeEvent;
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  native.events.clear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("atualização protegida por origem local", () => {
  it("não permite instalar a atualização por uma página de servidor remoto", async () => {
    installUpdater(() => remote, { kind: "auto" }, "win32", local);
    native.events.get("update-downloaded")!({ version: "0.2.0" });
    const handler = native.handle.mock.calls[0]![1] as (
      event: IpcMainInvokeEvent,
      action: string,
    ) => Promise<unknown>;
    await expect(handler(event(), "install")).rejects.toThrow("Origem");
    expect(native.quitAndInstall).not.toHaveBeenCalled();
    expect(native.showMessageBox).not.toHaveBeenCalled();
    expect(await handler(event(), "state")).toMatchObject({ kind: "ready", version: "0.2.0" });
  });
  it("mantém a mesma restrição quando atualizações estão desligadas", () => {
    installUpdater(() => remote, { kind: "off" }, "win32", local);
    const handler = native.handle.mock.calls[0]![1] as (
      event: IpcMainInvokeEvent,
      action: string,
    ) => unknown;
    expect(() => handler(event(), "install")).toThrow("Origem");
  });
});
