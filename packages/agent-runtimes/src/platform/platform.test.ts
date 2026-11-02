import { describe, expect, it } from "vitest";
import { buildChildEnv } from "./child-env.js";
import { ClaudeBinaryNotFoundError, findClaudeBinary, type FileProbe } from "./claude-binary.js";

describe("buildChildEnv", () => {
  const host = {
    PATH: "/usr/bin",
    HOME: "/home/ana",
    SystemRoot: "C:\\Windows",
    USERPROFILE: "C:\\Users\\ana",
    OPENAI_API_KEY: "segredo-1",
    NEURONS_MASTER_KEY: "segredo-2",
    ANTHROPIC_API_KEY: "segredo-3",
    CLAUDE_CODE_CHILD_SESSION: "1",
  };

  it("passes only the system minimum, never the host's secrets or app flags", () => {
    const env = buildChildEnv({ host, platform: "linux" });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/ana" });
  });

  it("uses the Windows set on win32, matching names case-insensitively", () => {
    const env = buildChildEnv({
      host: { ...host, Path: "C:\\bin", SYSTEMROOT: "C:\\Windows" },
      platform: "win32",
    });
    expect(Object.keys(env).sort()).toEqual(
      ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "USERPROFILE"].sort(),
    );
  });

  it("adds what the runtime asks for on top of the minimum", () => {
    const env = buildChildEnv({ host, platform: "linux", extra: { TERM: "xterm-256color" } });
    expect(env).toMatchObject({ PATH: "/usr/bin", TERM: "xterm-256color" });
  });
});

function files(existing: Record<string, string[] | null>): FileProbe {
  return {
    exists: (file) => file in existing && existing[file] === null,
    list: (directory) => existing[directory] ?? [],
  };
}

describe("findClaudeBinary", () => {
  const windows = {
    platform: "win32" as const,
    homeDir: "C:\\Users\\ana",
    host: { PATH: "C:\\tools;C:\\bin", LOCALAPPDATA: "C:\\Users\\ana\\AppData\\Local" },
  };

  it("prefers the configured binary and fails loudly when it is missing", () => {
    const probe = files({ "D:\\claude.exe": null });
    expect(findClaudeBinary("D:\\claude.exe", { ...windows, files: probe })).toBe("D:\\claude.exe");
    expect(() => findClaudeBinary("D:\\outro.exe", { ...windows, files: probe })).toThrow(
      /NEURONS_CLAUDE_BIN/,
    );
  });

  it("looks on the PATH before the known locations", () => {
    const probe = files({
      "C:\\bin\\claude.exe": null,
      "C:\\Users\\ana\\.local\\bin\\claude.exe": null,
    });
    expect(findClaudeBinary(undefined, { ...windows, files: probe })).toBe("C:\\bin\\claude.exe");
  });

  it("falls back to the known installer location", () => {
    const probe = files({ "C:\\Users\\ana\\.local\\bin\\claude.exe": null });
    expect(findClaudeBinary(undefined, { ...windows, files: probe })).toBe(
      "C:\\Users\\ana\\.local\\bin\\claude.exe",
    );
  });

  it("uses the newest CLI embedded in the Claude desktop app on Windows", () => {
    const packages = "C:\\Users\\ana\\AppData\\Local\\Packages";
    const root = `${packages}\\Claude_abc\\LocalCache\\Roaming\\Claude\\claude-code`;
    const probe = files({
      [packages]: ["Other_x", "Claude_abc"],
      [root]: ["2.1.9", "2.1.10", "2.1.308"],
      [`${root}\\2.1.308`]: ["aaa"],
      [`${root}\\2.1.308\\aaa\\claude.exe`]: null,
      [`${root}\\2.1.10`]: ["bbb"],
      [`${root}\\2.1.10\\bbb\\claude.exe`]: null,
    });
    // 2.1.308 is newer than 2.1.10 (numeric, not alphabetical, comparison).
    expect(findClaudeBinary(undefined, { ...windows, files: probe })).toBe(
      `${root}\\2.1.308\\aaa\\claude.exe`,
    );
  });

  it("looks on the PATH and in /usr/local on POSIX systems", () => {
    const probe = files({ "/opt/tools/claude": null });
    expect(
      findClaudeBinary(undefined, {
        platform: "linux",
        homeDir: "/home/ana",
        host: { PATH: "/usr/bin:/opt/tools" },
        files: probe,
      }),
    ).toBe("/opt/tools/claude");
  });

  it("explains how to install it when there is nothing", () => {
    expect(() => findClaudeBinary(undefined, { ...windows, files: files({}) })).toThrow(
      ClaudeBinaryNotFoundError,
    );
  });
});
