import type { IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopAccountManager } from "./account-manager.js";
const native = vi.hoisted(() => ({
  handle: vi.fn(),
  window: {},
  fromWebContents: vi.fn(),
  showOpenDialog: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: { handle: native.handle },
  BrowserWindow: { fromWebContents: native.fromWebContents },
  dialog: { showOpenDialog: native.showOpenDialog },
}));
const { installAccountControls } = await import("./account-controls.js");
const { installWindowControls } = await import("./window-controls.js");
const local = "http://127.0.0.1:41000",
  remote = "https://neurons.example.invalid";
beforeEach(() => {
  vi.clearAllMocks();
  native.fromWebContents.mockReturnValue(native.window);
});
function event(origin: string, subframe = false): IpcMainInvokeEvent {
  const frame = { url: `${origin}/graphs` };
  return {
    senderFrame: frame,
    sender: { mainFrame: subframe ? { url: frame.url } : frame },
  } as unknown as IpcMainInvokeEvent;
}
function setup(origin: string) {
  const manager = {
    state: vi.fn(() => ({ mode: "remote", serverOrigin: remote })),
    signIn: vi.fn(() => Promise.resolve()),
    connect: vi.fn(() => Promise.resolve()),
    forget: vi.fn(() => Promise.resolve()),
    openLocal: vi.fn(() => Promise.resolve()),
    cancelLogin: vi.fn(),
  };
  installAccountControls(
    manager as unknown as DesktopAccountManager,
    local,
    () => origin,
    () => native.window as never,
  );
  const handler = native.handle.mock.calls.find(([name]) => name === "neurons:account")![1] as (
    event: IpcMainInvokeEvent,
    action: unknown,
    value?: unknown,
  ) => Promise<unknown>;
  return { manager, handler };
}
describe("ponte nativa de conta", () => {
  it("configura servidores somente pela página local e não aceita objetos como endereço", async () => {
    const { manager, handler } = setup(local);
    await handler(event(local), "connect", remote);
    expect(manager.connect).toHaveBeenCalledWith(remote);
    await expect(handler(event(local), "connect", { url: remote })).rejects.toThrow("inválido");
    expect(manager.connect).toHaveBeenCalledOnce();
  });
  it("permite entrar e voltar ao local, mas impede a página remota de trocar ou esquecer o servidor", async () => {
    const { manager, handler } = setup(remote);
    await handler(event(remote), "login");
    await handler(event(remote), "local");
    expect(manager.signIn).toHaveBeenCalledOnce();
    expect(manager.openLocal).toHaveBeenCalledOnce();
    await expect(handler(event(remote), "connect", "https://other.invalid")).rejects.toThrow(
      "Origem",
    );
    await expect(handler(event(remote), "forget")).rejects.toThrow("Origem");
    expect(manager.connect).not.toHaveBeenCalled();
    expect(manager.forget).not.toHaveBeenCalled();
  });
  it("recusa subframe, outra origem e uma janela antiga", async () => {
    const { manager, handler } = setup(remote);
    await expect(handler(event(remote, true), "state")).rejects.toThrow("Origem");
    await expect(handler(event("https://other.invalid"), "state")).rejects.toThrow("Origem");
    native.fromWebContents.mockReturnValue({});
    await expect(handler(event(remote), "state")).rejects.toThrow("Janela");
    expect(manager.state).not.toHaveBeenCalled();
  });
  it("remove detalhes de erros nativos que poderiam conter uma credencial", async () => {
    const { manager, handler } = setup(remote);
    manager.signIn.mockRejectedValue(new Error("cookie-value-private"));
    await expect(handler(event(remote), "login")).rejects.not.toThrow("cookie-value-private");
  });
  it("não abre o seletor de pasta para uma página de servidor remoto", async () => {
    installWindowControls(() => remote, local);
    const handler = native.handle.mock.calls.find(([name]) => name === "neurons:directory")![1] as (
      event: IpcMainInvokeEvent,
    ) => Promise<unknown>;
    await expect(handler(event(remote))).rejects.toThrow("Origem");
    expect(native.showOpenDialog).not.toHaveBeenCalled();
  });
});
