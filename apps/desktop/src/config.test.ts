import { describe, expect, it } from "vitest";
import { DesktopConfigError, loadDesktopConfig } from "./config.js";

describe("loadDesktopConfig", () => {
  it("uses the real Claude Code CLI when nothing is set", () => {
    expect(loadDesktopConfig({})).toEqual({});
    expect(
      loadDesktopConfig({ NEURONS_DESKTOP_CLAUDE_COMMAND: "", NEURONS_DESKTOP_CLAUDE_ARGS: "" }),
    ).toEqual({});
  });

  it("reads a replacement CLI and its leading arguments", () => {
    expect(
      loadDesktopConfig({
        NEURONS_DESKTOP_CLAUDE_COMMAND: "node",
        NEURONS_DESKTOP_CLAUDE_ARGS: '["fake-claude.mjs","--x"]',
      }),
    ).toEqual({ claudeCommand: { command: "node", args: ["fake-claude.mjs", "--x"] } });
    expect(loadDesktopConfig({ NEURONS_DESKTOP_CLAUDE_COMMAND: "fake" })).toEqual({
      claudeCommand: { command: "fake", args: [] },
    });
  });

  it("reads the update switch and the AppImage marker", () => {
    expect(
      loadDesktopConfig({ NEURONS_DESKTOP_UPDATES: "off", APPIMAGE: "/x/NeuronsAI.AppImage" }),
    ).toEqual({
      updatesOff: true,
      appImage: true,
    });
    expect(loadDesktopConfig({ NEURONS_DESKTOP_UPDATES: "on" })).toEqual({});
    expect(() => loadDesktopConfig({ NEURONS_DESKTOP_UPDATES: "maybe" })).toThrow(
      DesktopConfigError,
    );
  });

  it.each([
    [
      "arguments that are not JSON",
      { NEURONS_DESKTOP_CLAUDE_COMMAND: "n", NEURONS_DESKTOP_CLAUDE_ARGS: "a b" },
    ],
    [
      "arguments that are not a list of texts",
      { NEURONS_DESKTOP_CLAUDE_COMMAND: "n", NEURONS_DESKTOP_CLAUDE_ARGS: "[1]" },
    ],
    ["arguments without a command", { NEURONS_DESKTOP_CLAUDE_ARGS: '["a"]' }],
  ])("rejects %s", (_label, env) => {
    expect(() => loadDesktopConfig(env)).toThrow(DesktopConfigError);
  });
});
