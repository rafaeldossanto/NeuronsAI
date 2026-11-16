import { describe, expect, it } from "vitest";
import { fakeCodexCommand } from "../testing/fake-codex-support.js";
import { CodexCli, CodexLoginRequiredError, CodexWrongLoginError } from "./codex-cli.js";

const cliWith = (...flags: string[]) => new CodexCli({ command: fakeCodexCommand(...flags) });

describe("CodexCli", () => {
  it("reads the login from `codex login status`: ChatGPT, API key or nobody", async () => {
    expect(await cliWith().loginStatus()).toEqual({ loggedIn: true, method: "chatgpt" });
    expect(await cliWith("--api-login").loginStatus()).toEqual({
      loggedIn: true,
      method: "api-key",
    });
    expect(await cliWith("--logged-out").loginStatus()).toEqual({
      loggedIn: false,
      method: "unknown",
    });
  });

  it("asks the CLI each time and caches only a successful check", async () => {
    await expect(cliWith("--logged-out").ensureLoggedIn()).rejects.toThrow(CodexLoginRequiredError);
    await expect(cliWith().ensureLoggedIn()).resolves.toBeUndefined();
  });

  it("refuses an API-key login when the subscription is what the agent asked for", async () => {
    const cli = cliWith("--api-login");
    await expect(cli.ensureLoggedIn({ requireChatgpt: true })).rejects.toThrow(
      CodexWrongLoginError,
    );
    await expect(cli.ensureLoggedIn()).resolves.toBeUndefined();
  });

  it("counts a CLI that is not installed as not logged in", async () => {
    const cli = new CodexCli({ command: { command: "neurons-no-such-codex", args: [] } });
    expect(await cli.loginStatus()).toEqual({ loggedIn: false, method: "unknown" });
  });

  it("gives the official login command, with the arguments that start the CLI", () => {
    const { command, args } = cliWith().loginCommand();
    expect(command).toBe(process.execPath);
    expect(args.at(-1)).toBe("login");
    expect(args[0]).toMatch(/fake-codex\.mjs$/);
  });

  it("finds the binary from the configured path and reports a missing one for the user", () => {
    const cli = new CodexCli({
      configuredBinary: "Z:\\nada\\codex.exe",
      files: { exists: () => false, list: () => [] },
    });
    expect(() => cli.command()).toThrow(/NEURONS_CODEX_BIN/);
  });
});
