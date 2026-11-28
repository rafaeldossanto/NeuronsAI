import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { RunnerView } from "../runner/runner-manager.js";

vi.mock("electron", () => ({ Menu: {}, app: {}, shell: {} }));

const { buildMenuTemplate } = await import("./menu.js");

const labels = (platform: NodeJS.Platform, developing: boolean) =>
  buildMenuTemplate(platform, developing).map((item) => item.label);

describe("buildMenuTemplate", () => {
  it("starts with the app menu only on macOS", () => {
    expect(labels("darwin", false)[0]).toBe("NeuronsAI");
    expect(labels("win32", false)[0]).toBe("Arquivo");
    expect(labels("linux", false)[0]).toBe("Arquivo");
  });

  it("puts Quit under File on Windows and Linux", () => {
    for (const platform of ["win32", "linux"] as const) {
      const file = buildMenuTemplate(platform, false).find((item) => item.label === "Arquivo");
      expect(JSON.stringify(file?.submenu)).toContain('"role":"quit"');
    }
  });

  it("offers reload and developer tools only in development", () => {
    expect(JSON.stringify(buildMenuTemplate("win32", true))).toContain("toggleDevTools");
    expect(JSON.stringify(buildMenuTemplate("win32", false))).not.toContain("toggleDevTools");
  });

  describe("runner deste computador", () => {
    const runnerItem = (view: RunnerView, choose = vi.fn()) => {
      const file = buildMenuTemplate("win32", false, { view: () => view, choose }).find(
        (item) => item.label === "Arquivo",
      );
      const item = (file?.submenu as MenuItemConstructorOptions[]).find(
        (entry) => entry.label === "Runner deste computador",
      );
      return { item, choose };
    };

    it("offers the three choices and the status line on a remote server", () => {
      const { item, choose } = runnerItem({
        remote: true,
        mode: "organization",
        status: "Conectado como meu-pc",
      });
      expect(item?.visible).toBe(true);
      const entries = item?.submenu as MenuItemConstructorOptions[];
      const radios = entries.filter((entry) => entry.type === "radio");
      expect(radios.map((entry) => [entry.label, entry.checked])).toEqual([
        ["Pessoal — só as minhas execuções", false],
        ["Organização — execuções de toda a equipe", true],
        ["Desligado", false],
      ]);
      const status = entries.at(-1);
      expect([status?.label, status?.enabled]).toEqual(["Conectado como meu-pc", false]);
      radios[2]!.click?.({} as never, undefined, {});
      expect(choose).toHaveBeenCalledWith("off");
    });

    it("hides the submenu in the local space", () => {
      const { item } = runnerItem({ remote: false, mode: "personal", status: "Desligado" });
      expect(item?.visible).toBe(false);
      expect(item?.enabled).toBe(false);
    });
  });
});
