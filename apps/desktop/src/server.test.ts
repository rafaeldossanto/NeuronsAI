import { loadConfig } from "@neurons/server";
import { describe, expect, it } from "vitest";
import { withTriggers } from "./server.js";

describe("withTriggers", () => {
  const base = loadConfig({});

  it("adds no webhook listener while the triggers are off", () => {
    expect(withTriggers(base, { enabled: false, port: 3101 }).hooks).toBeUndefined();
  });

  it("opens the port the person chose, on loopback only", () => {
    const config = withTriggers(base, { enabled: true, port: 4100 });
    expect(config.hooks).toMatchObject({ port: 4100, host: "127.0.0.1" });
    expect(config.hooks?.maxBodyBytes).toBeGreaterThan(0);
    expect(config.hooks?.ratePerMinute).toBeGreaterThan(0);
  });

  it("leaves the rest of the configuration alone", () => {
    const config = withTriggers(base, { enabled: true, port: 4100 });
    expect({ ...config, hooks: undefined }).toEqual({ ...base, hooks: undefined });
  });

  it("lets NEURONS_HOOKS_PORT win over the screen", () => {
    const fromEnvironment = loadConfig({ NEURONS_HOOKS_PORT: "3200" });
    expect(withTriggers(fromEnvironment, { enabled: true, port: 4100 }).hooks?.port).toBe(3200);
    expect(withTriggers(fromEnvironment, { enabled: false, port: 4100 }).hooks?.port).toBe(3200);
  });
});
