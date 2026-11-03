import { describe, expect, it } from "vitest";
import { loadRunnerConfig, runnerEndpoint, RunnerConfigError } from "./config.js";

describe("runnerEndpoint", () => {
  it("points to the /runner path of the server, switching http to ws", () => {
    expect(runnerEndpoint("http://127.0.0.1:3100")).toBe("ws://127.0.0.1:3100/runner");
    expect(runnerEndpoint("https://neurons.exemplo.com.br")).toBe(
      "wss://neurons.exemplo.com.br/runner",
    );
    expect(runnerEndpoint("wss://neurons.exemplo.com.br/runner/")).toBe(
      "wss://neurons.exemplo.com.br/runner",
    );
  });

  it("keeps a path prefix (a reverse proxy) and drops credentials, query and fragment", () => {
    expect(runnerEndpoint("https://u:senha@host.com/api?x=1#y")).toBe("wss://host.com/api/runner");
  });

  it("refuses to send the token in the clear to another machine, unless told so", () => {
    expect(() => runnerEndpoint("http://neurons.exemplo.com.br")).toThrow(RunnerConfigError);
    expect(runnerEndpoint("http://neurons.exemplo.com.br", true)).toBe(
      "ws://neurons.exemplo.com.br/runner",
    );
  });

  it("refuses an address that is not one", () => {
    expect(() => runnerEndpoint("não é um endereço")).toThrow(RunnerConfigError);
    expect(() => runnerEndpoint("ftp://host")).toThrow(RunnerConfigError);
  });
});

describe("loadRunnerConfig", () => {
  const token = `nrn_${"a".repeat(40)}`;

  it("reads the server, the token and the optional name and CLI path", () => {
    const config = loadRunnerConfig({
      NEURONS_SERVER_URL: "http://localhost:3100",
      NEURONS_RUNNER_TOKEN: token,
      NEURONS_RUNNER_NAME: "meu-notebook",
      NEURONS_CLAUDE_BIN: "",
    });

    expect(config).toEqual({ url: "ws://localhost:3100/runner", token, name: "meu-notebook" });
  });

  it("lists everything that is missing and never echoes the token", () => {
    try {
      loadRunnerConfig({ NEURONS_RUNNER_TOKEN: "", NEURONS_SERVER_URL: "" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RunnerConfigError);
      expect((error as Error).message).toContain("NEURONS_SERVER_URL");
      expect((error as Error).message).toContain("NEURONS_RUNNER_TOKEN");
    }

    expect(() =>
      loadRunnerConfig({ NEURONS_SERVER_URL: "ftp://x", NEURONS_RUNNER_TOKEN: token }),
    ).toThrow(/NEURONS_SERVER_URL/);
    try {
      loadRunnerConfig({ NEURONS_SERVER_URL: "ftp://x", NEURONS_RUNNER_TOKEN: token });
    } catch (error) {
      expect((error as Error).message).not.toContain(token);
    }
  });
});
