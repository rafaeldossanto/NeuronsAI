import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAvatarImage } from "./avatar-image";
import { useAvatar } from "./use-avatar";
vi.mock("./avatar-image", () => ({ readAvatarImage: vi.fn() }));
const image = "data:image/png;base64,iVBORw0KGgo=";
const file = new File(["image"], "foto.png", { type: "image/png" });
beforeEach(() => {
  localStorage.clear();
  vi.mocked(readAvatarImage).mockResolvedValue(image);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  localStorage.clear();
});
describe("avatar da conta", () => {
  it("salva no navegador e recupera ao reabrir a interface", async () => {
    const first = renderHook(() => useAvatar(undefined));
    await waitFor(() => expect(first.result.current.busy).toBe(false));
    await act(() => first.result.current.change(file));
    expect(first.result.current.image).toBe(image);
    first.unmount();
    const next = renderHook(() => useAvatar(undefined));
    await waitFor(() => expect(next.result.current.image).toBe(image));
  });
  it("usa o perfil nativo para persistir no desktop, sem depender do endereço local", async () => {
    const bridge = { read: vi.fn(() => Promise.resolve(null)), write: vi.fn(async () => {}) };
    vi.stubGlobal("neuronsDesktop", { avatar: bridge, localResources: true });
    const { result } = renderHook(() => useAvatar(undefined));
    await waitFor(() => expect(result.current.busy).toBe(false));
    await act(() => result.current.change(file));
    expect(bridge.write).toHaveBeenCalledWith(image);
    expect(localStorage.length).toBe(0);
  });
  it("separa as imagens entre usuários e não acessa o perfil local em uma página remota", async () => {
    const bridge = { read: vi.fn(), write: vi.fn() };
    vi.stubGlobal("neuronsDesktop", { avatar: bridge, localResources: false });
    localStorage.setItem("neurons:avatar:first", image);
    const { result, rerender } = renderHook(({ id }) => useAvatar(id), {
      initialProps: { id: "first" },
    });
    await waitFor(() => expect(result.current.image).toBe(image));
    rerender({ id: "second" });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.image).toBeNull();
    expect(bridge.read).not.toHaveBeenCalled();
  });
  it("mantém a foto anterior e permite tentar novamente se salvar falhar", async () => {
    const bridge = { read: vi.fn(() => Promise.resolve(image)), write: vi.fn(async () => {}) };
    bridge.write.mockRejectedValueOnce(new Error("falha ao gravar"));
    vi.stubGlobal("neuronsDesktop", { avatar: bridge, localResources: true });
    const { result } = renderHook(() => useAvatar(undefined));
    await waitFor(() => expect(result.current.image).toBe(image));
    await act(() => result.current.change(file));
    expect(result.current.image).toBe(image);
    expect(result.current.error).toBe(
      "Não foi possível salvar a imagem do perfil. Tente novamente.",
    );
    expect(result.current.busy).toBe(false);
    await act(() => result.current.change(file));
    expect(result.current.error).toBe("");
  });
});
