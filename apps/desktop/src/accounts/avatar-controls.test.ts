import type { IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AvatarStore } from "./avatar-store.js";
const native = vi.hoisted(() => ({ handle: vi.fn(), fromWebContents: vi.fn() }));
vi.mock("electron", () => ({
  ipcMain: { handle: native.handle },
  BrowserWindow: { fromWebContents: native.fromWebContents },
}));
const { installAvatarControls } = await import("./avatar-controls.js");
const origin = "http://127.0.0.1:41000";
function event(url = origin, subframe = false): IpcMainInvokeEvent {
  const frame = { url };
  return {
    senderFrame: frame,
    sender: { mainFrame: subframe ? { url } : frame },
  } as unknown as IpcMainInvokeEvent;
}
beforeEach(() => {
  vi.clearAllMocks();
  native.fromWebContents.mockReturnValue({});
});
function setup() {
  const store = {
    load: vi.fn(() => Promise.resolve("avatar")),
    save: vi.fn<(value: unknown) => Promise<void>>(() => Promise.resolve()),
  };
  installAvatarControls(store as unknown as AvatarStore, origin);
  const handler = native.handle.mock.calls[0]![1] as (
    event: IpcMainInvokeEvent,
    action: unknown,
    value?: unknown,
  ) => Promise<unknown>;
  return { store, handler };
}
describe("ponte da imagem do perfil", () => {
  it("lê e grava apenas pela interface local", async () => {
    const { store, handler } = setup();
    expect(await handler(event(), "read")).toBe("avatar");
    await handler(event(), "write", "nova imagem");
    expect(store.save).toHaveBeenCalledWith("nova imagem");
    await expect(handler(event("https://remote.invalid"), "read")).rejects.toThrow("Origem");
    await expect(handler(event(origin, true), "write", "imagem")).rejects.toThrow("Origem");
    expect(store.save).toHaveBeenCalledOnce();
  });
  it("não expõe detalhes de falhas nativas", async () => {
    const { store, handler } = setup();
    store.save.mockRejectedValue(new Error("caminho interno"));
    await expect(handler(event(), "write", "imagem")).rejects.toThrow("Não foi possível salvar");
    await expect(handler(event(), "outro")).rejects.toThrow("Não foi possível salvar");
  });
});
