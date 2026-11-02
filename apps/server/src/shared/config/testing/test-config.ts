import { randomBytes } from "node:crypto";
import type { AppConfig } from "../app-config.js";

/** A complete config for tests: loopback, an embedded database, no flush wait, a throwaway master key. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    mode: "all",
    host: "127.0.0.1",
    port: 0,
    askTimeoutMs: 5_000,
    usageFlushMs: 0,
    guards: { runMaxMessages: 200, pingPongMessages: 20 },
    dataDir: "unused",
    database: { kind: "embedded" },
    masterKey: randomBytes(32),
    ...overrides,
  };
}
