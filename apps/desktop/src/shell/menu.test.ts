import { describe, expect, it, vi } from "vitest";

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
});
