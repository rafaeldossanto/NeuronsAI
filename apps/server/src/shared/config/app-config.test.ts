import { randomBytes } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig as loadConfigFor } from "./app-config.js";
import type { HostInfo } from "./data-dir.js";

const host: HostInfo = { platform: "linux", homedir: "/home/ana" };
const loadConfig = (env: NodeJS.ProcessEnv) => loadConfigFor(env, host);

/** What the config holds when nothing is set. */
const defaults = {
  mode: "all",
  host: "127.0.0.1",
  port: 3100,
  guards: { runMaxMessages: 200, pingPongMessages: 20 },
  profile: "local",
  runners: { graceMs: 60_000, heartbeatMs: 15_000, waitMs: 30_000 },
  usageFlushMs: 4_000,
  askTimeoutMs: 120_000,
  dataDir: "/home/ana/.local/share/neuronsai",
  database: { kind: "embedded" },
};

describe("loadConfig", () => {
  it("applies defaults when nothing is set", () => {
    expect(loadConfig({})).toEqual(defaults);
  });

  it("treats empty variables (as in .env.example) as unset", () => {
    const config = loadConfig({
      NEURONS_MODE: "",
      NEURONS_PORT: "",
      NEURONS_DB: "",
      NEURONS_DATA_DIR: "",
      NEURONS_DB_URL: "",
      NEURONS_DB_HOST: "",
      NEURONS_MASTER_KEY: "",
    });

    expect(config).toEqual(defaults);
  });

  it("reads the profile and the runner timings", () => {
    const config = loadConfig({
      NEURONS_PROFILE: "hybrid",
      NEURONS_RUNNER_GRACE_SEC: "90",
      NEURONS_RUNNER_HEARTBEAT_SEC: "5",
      NEURONS_RUNNER_WAIT_SEC: "0",
    });

    expect(config.profile).toBe("hybrid");
    expect(config.runners).toEqual({ graceMs: 90_000, heartbeatMs: 5_000, waitMs: 0 });
  });

  it("rejects a profile that does not exist, together with the other problems", () => {
    const message = (() => {
      try {
        loadConfig({ NEURONS_PROFILE: "nuvem", NEURONS_PORT: "0" });
      } catch (error) {
        return (error as Error).message;
      }
      return "";
    })();

    expect(message).toContain("NEURONS_PROFILE");
    expect(message).toContain("NEURONS_PORT");
  });

  it("reads the path of the Claude Code executable, which is optional", () => {
    expect(loadConfig({ NEURONS_CLAUDE_BIN: String.raw` C:\Tools\claude.exe ` }).claudeBin).toBe(
      String.raw`C:\Tools\claude.exe`,
    );
    expect(loadConfig({ NEURONS_CLAUDE_BIN: "" })).not.toHaveProperty("claudeBin");
  });

  it("reads the ask timeout in seconds", () => {
    expect(loadConfig({ NEURONS_ASK_TIMEOUT_SEC: "30" }).askTimeoutMs).toBe(30_000);
  });

  it("rejects an ask timeout that is not a positive number of seconds", () => {
    expect(() => loadConfig({ NEURONS_ASK_TIMEOUT_SEC: "0" })).toThrow(ConfigError);
  });

  it("reads mode and port", () => {
    expect(loadConfig({ NEURONS_MODE: "api", NEURONS_PORT: "4000" })).toMatchObject({
      mode: "api",
      port: 4000,
    });
  });

  it("uses NEURONS_DB_URL as is", () => {
    const url = "postgres://neurons:pw@localhost:5432/neurons_dev";

    expect(loadConfig({ NEURONS_DB: "postgres", NEURONS_DB_URL: url }).database).toEqual({
      kind: "postgres",
      connection: { connectionString: url },
    });
  });

  it("builds the connection from the individual parts, defaulting the port", () => {
    const config = loadConfig({
      NEURONS_DB: "postgres",
      NEURONS_DB_HOST: "127.0.0.1",
      NEURONS_DB_USER: "neurons",
      NEURONS_DB_NAME: "neurons_dev",
      NEURONS_DB_PASSWORD: "p@ss:word/with#chars",
    });

    expect(config.database).toEqual({
      kind: "postgres",
      connection: {
        host: "127.0.0.1",
        port: 5432,
        user: "neurons",
        database: "neurons_dev",
        password: "p@ss:word/with#chars",
      },
    });
  });

  it("prefers NEURONS_DB_URL over the individual parts", () => {
    const url = "postgres://a:b@h:1/d";

    const config = loadConfig({
      NEURONS_DB: "postgres",
      NEURONS_DB_URL: url,
      NEURONS_DB_HOST: "other",
    });

    expect(config.database).toEqual({ kind: "postgres", connection: { connectionString: url } });
  });

  it("uses the embedded database by default and ignores the Postgres variables then", () => {
    const config = loadConfig({ NEURONS_DB_URL: "postgres://a:b@h:1/d", NEURONS_DB_HOST: "h" });

    expect(config.database).toEqual({ kind: "embedded" });
  });

  it("leaves the Postgres connection out when NEURONS_DB=postgres has no variables", () => {
    expect(loadConfig({ NEURONS_DB: "postgres" }).database).toEqual({ kind: "postgres" });
  });

  it("uses NEURONS_DATA_DIR when set, resolved to an absolute path", () => {
    expect(loadConfig({ NEURONS_DATA_DIR: "/srv/neurons" }).dataDir).toBe(
      path.resolve("/srv/neurons"),
    );
  });

  it("decodes a valid master key", () => {
    const key = randomBytes(32);

    expect(loadConfig({ NEURONS_MASTER_KEY: key.toString("base64") }).masterKey).toEqual(key);
  });

  it.each([
    ["an unknown mode", { NEURONS_MODE: "everything" }, "NEURONS_MODE"],
    ["an unknown database kind", { NEURONS_DB: "sqlite" }, "NEURONS_DB"],
    ["a non-numeric port", { NEURONS_PORT: "abc" }, "NEURONS_PORT"],
    ["an out-of-range port", { NEURONS_PORT: "70000" }, "NEURONS_PORT"],
    ["a malformed URL", { NEURONS_DB_URL: "not a url" }, "NEURONS_DB_URL"],
    [
      "a short master key",
      { NEURONS_MASTER_KEY: randomBytes(16).toString("base64") },
      "NEURONS_MASTER_KEY",
    ],
    [
      "a master key that is not base64",
      { NEURONS_MASTER_KEY: "%".repeat(44) },
      "NEURONS_MASTER_KEY",
    ],
  ])("fails early on %s, naming the variable", (_label, env, variable) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(variable);
  });

  it("explains which database variables are missing", () => {
    const env = {
      NEURONS_DB: "postgres",
      NEURONS_DB_HOST: "localhost",
      NEURONS_DB_USER: "neurons",
    };

    expect(() => loadConfig(env)).toThrow(/NEURONS_DB_NAME, NEURONS_DB_PASSWORD/);
  });

  it("reports every problem at once", () => {
    const failure = (() => {
      try {
        loadConfig({ NEURONS_MODE: "x", NEURONS_PORT: "y" });
      } catch (error) {
        return error as ConfigError;
      }
    })();

    expect(failure?.problems).toHaveLength(2);
  });

  it("never echoes the password in error messages", () => {
    const env = {
      NEURONS_DB: "postgres",
      NEURONS_DB_HOST: "h",
      NEURONS_DB_PASSWORD: "super-secret",
    };

    expect(() => loadConfig(env)).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("super-secret") as string }),
    );
  });
});

describe("listening address", () => {
  it("is loopback by default", () => {
    expect(loadConfig({}).host).toBe("127.0.0.1");
  });

  it("accepts other loopback addresses without any opt-in", () => {
    expect(loadConfig({ NEURONS_HOST: "localhost" }).host).toBe("localhost");
    expect(loadConfig({ NEURONS_HOST: "::1" }).host).toBe("::1");
    expect(loadConfig({ NEURONS_HOST: "127.0.0.2" }).host).toBe("127.0.0.2");
  });

  it("refuses to listen outside this machine unless NEURONS_ALLOW_REMOTE=true", () => {
    expect(() => loadConfig({ NEURONS_HOST: "0.0.0.0" })).toThrow(/NEURONS_ALLOW_REMOTE/);
    expect(() =>
      loadConfig({ NEURONS_HOST: "192.168.0.5", NEURONS_ALLOW_REMOTE: "false" }),
    ).toThrow(ConfigError);
    expect(loadConfig({ NEURONS_HOST: "0.0.0.0", NEURONS_ALLOW_REMOTE: "true" }).host).toBe(
      "0.0.0.0",
    );
  });
});

describe("guard limits", () => {
  it("reads the limits and the usage flush window", () => {
    const config = loadConfig({
      NEURONS_RUN_MAX_MESSAGES: "50",
      NEURONS_PING_PONG_MESSAGES: "8",
      NEURONS_RUN_BUDGET_USD: "2.5",
      NEURONS_USAGE_FLUSH_MS: "1500",
    });

    expect(config.guards).toEqual({ runMaxMessages: 50, pingPongMessages: 8, runBudgetUsd: 2.5 });
    expect(config.usageFlushMs).toBe(1500);
  });

  it("rejects limits that make no sense", () => {
    expect(() => loadConfig({ NEURONS_PING_PONG_MESSAGES: "1" })).toThrow(ConfigError);
    expect(() => loadConfig({ NEURONS_RUN_MAX_MESSAGES: "0" })).toThrow(ConfigError);
    expect(() => loadConfig({ NEURONS_RUN_BUDGET_USD: "-3" })).toThrow(ConfigError);
  });
});
