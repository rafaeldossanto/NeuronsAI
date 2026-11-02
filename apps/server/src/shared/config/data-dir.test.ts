import { describe, expect, it } from "vitest";
import { defaultDataDir } from "./data-dir.js";

describe("defaultDataDir", () => {
  it("uses %APPDATA%\\NeuronsAI on Windows", () => {
    const host = { platform: "win32", homedir: "C:\\Users\\Ana" } as const;

    expect(defaultDataDir({ APPDATA: "C:\\Users\\Ana\\AppData\\Roaming" }, host)).toBe(
      "C:\\Users\\Ana\\AppData\\Roaming\\NeuronsAI",
    );
  });

  it("falls back to the Roaming folder of the user when %APPDATA% is missing", () => {
    const host = { platform: "win32", homedir: "C:\\Users\\Ana" } as const;

    expect(defaultDataDir({}, host)).toBe("C:\\Users\\Ana\\AppData\\Roaming\\NeuronsAI");
  });

  it("uses ~/Library/Application Support/NeuronsAI on macOS", () => {
    const host = { platform: "darwin", homedir: "/Users/ana" } as const;

    expect(defaultDataDir({}, host)).toBe("/Users/ana/Library/Application Support/NeuronsAI");
  });

  it("uses $XDG_DATA_HOME/neuronsai on Linux", () => {
    const host = { platform: "linux", homedir: "/home/ana" } as const;

    expect(defaultDataDir({ XDG_DATA_HOME: "/data/xdg" }, host)).toBe("/data/xdg/neuronsai");
  });

  it.each([
    ["is not set", {}],
    ["is empty", { XDG_DATA_HOME: "" }],
    ["is relative (the XDG spec says to ignore it)", { XDG_DATA_HOME: "data" }],
  ])("uses ~/.local/share/neuronsai on Linux when XDG_DATA_HOME %s", (_label, env) => {
    const host = { platform: "linux", homedir: "/home/ana" } as const;

    expect(defaultDataDir(env, host)).toBe("/home/ana/.local/share/neuronsai");
  });

  it("treats other Unix systems like Linux", () => {
    const host = { platform: "freebsd", homedir: "/home/ana" } as const;

    expect(defaultDataDir({}, host)).toBe("/home/ana/.local/share/neuronsai");
  });
});
