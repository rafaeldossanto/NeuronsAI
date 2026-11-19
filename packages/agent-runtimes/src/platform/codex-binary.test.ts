import { describe, expect, it } from "vitest";
import type { FileProbe } from "./claude-binary.js";
import { CodexBinaryNotFoundError, codexLaunchFor, findCodexBinary } from "./codex-binary.js";

const probe = (...present: string[]): FileProbe => ({
  exists: (file) => present.includes(file),
  list: () => [],
});

const npm = "C:\\Users\\ana\\AppData\\Roaming\\npm";

describe("findCodexBinary", () => {
  const windowsHost = {
    platform: "win32" as const,
    host: { PATH: `C:\\bin;${npm}`, APPDATA: "C:\\Users\\ana\\AppData\\Roaming" },
    homeDir: "C:\\Users\\ana",
  };

  it("uses the configured path, and says so when it is not there", () => {
    expect(
      findCodexBinary("D:\\codex.exe", { ...windowsHost, files: probe("D:\\codex.exe") }),
    ).toBe("D:\\codex.exe");
    expect(() => findCodexBinary("D:\\outro.exe", { ...windowsHost, files: probe() })).toThrow(
      /NEURONS_CODEX_BIN/,
    );
  });

  it("finds codex.exe or the npm shim on the PATH, preferring the native one", () => {
    expect(findCodexBinary(undefined, { ...windowsHost, files: probe(`${npm}\\codex.cmd`) })).toBe(
      `${npm}\\codex.cmd`,
    );
    expect(
      findCodexBinary(undefined, {
        ...windowsHost,
        files: probe(`${npm}\\codex.cmd`, "C:\\bin\\codex.exe"),
      }),
    ).toBe("C:\\bin\\codex.exe");
  });

  it("finds the npm folder even when the PATH of the host lacks it", () => {
    const host = {
      ...windowsHost,
      host: { PATH: "C:\\bin", APPDATA: "C:\\Users\\ana\\AppData\\Roaming" },
    };
    expect(findCodexBinary(undefined, { ...host, files: probe(`${npm}\\codex.cmd`) })).toBe(
      `${npm}\\codex.cmd`,
    );
  });

  it("finds it in the folders npm and Homebrew use on macOS/Linux", () => {
    const lookup = { platform: "linux" as const, host: { PATH: "/usr/bin" }, homeDir: "/home/ana" };
    expect(findCodexBinary(undefined, { ...lookup, files: probe("/opt/homebrew/bin/codex") })).toBe(
      "/opt/homebrew/bin/codex",
    );
  });

  it("tells how to install it when it is nowhere", () => {
    const attempt = () => findCodexBinary(undefined, { ...windowsHost, files: probe() });
    expect(attempt).toThrow(CodexBinaryNotFoundError);
    expect(attempt).toThrow(/npm i -g @openai\/codex/);
  });
});

describe("codexLaunchFor", () => {
  const lookup = {
    platform: "win32" as const,
    host: { PATH: "C:\\Program Files\\nodejs" },
    homeDir: "C:\\Users\\ana",
  };
  const script = `${npm}\\node_modules\\@openai\\codex\\bin\\codex.js`;

  it("runs a native binary as it is", () => {
    expect(codexLaunchFor("C:\\bin\\codex.exe", lookup)).toEqual({
      command: "C:\\bin\\codex.exe",
      args: [],
    });
  });

  it("replaces a Windows npm shim by Node running the package's script (a shim cannot be spawned without a shell)", () => {
    const files = probe(script, "C:\\Program Files\\nodejs\\node.exe");
    expect(codexLaunchFor(`${npm}\\codex.cmd`, { ...lookup, files })).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: [script],
    });
  });

  it("explains what is missing when the shim's package or Node is not there", () => {
    expect(() => codexLaunchFor(`${npm}\\codex.cmd`, { ...lookup, files: probe() })).toThrow(
      /npm i -g @openai\/codex/,
    );
    expect(() => codexLaunchFor(`${npm}\\codex.cmd`, { ...lookup, files: probe(script) })).toThrow(
      /Node\.js/,
    );
  });
});
