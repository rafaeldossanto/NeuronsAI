import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRIGGERS,
  SettingsError,
  appliedFrom,
  parseTriggersSettings,
  startWithTriggersFallback,
  triggersView,
} from "./triggers-settings.js";

describe("parseTriggersSettings", () => {
  it("is off by default, on the port the README uses", () => {
    expect(DEFAULT_TRIGGERS).toEqual({ enabled: false, port: 3101 });
  });

  it("accepts exactly an enabled flag and a port from 1024 to 65535", () => {
    expect(parseTriggersSettings({ enabled: true, port: 3101 })).toEqual({
      enabled: true,
      port: 3101,
    });
    expect(parseTriggersSettings({ enabled: false, port: 1024 }).port).toBe(1024);
    expect(parseTriggersSettings({ enabled: false, port: 65_535 }).port).toBe(65_535);
  });

  it.each([1023, 0, -1, 65_536, 3101.5, "3101", null, Number.NaN])(
    "refuses the port %s with the accepted range, in pt-BR",
    (port) => {
      expect(() => parseTriggersSettings({ enabled: true, port })).toThrow(
        new SettingsError("Use uma porta entre 1024 e 65535."),
      );
    },
  );

  it.each([
    undefined,
    null,
    "texto",
    {},
    { enabled: "sim", port: 3101 },
    { enabled: true },
    { enabled: true, port: 3101, host: "0.0.0.0" }, // nothing else can be named from the page
    { enabled: true, port: 3101, command: "calc" },
  ])("refuses what is not exactly { enabled, port }: %j", (value) => {
    expect(() => parseTriggersSettings(value)).toThrow(SettingsError);
  });
});

describe("triggersView", () => {
  const off = appliedFrom(undefined, "app");
  const on = appliedFrom({ port: 3101, host: "127.0.0.1" }, "app");

  it("shows the address while the port is open, and none while it is off", () => {
    expect(triggersView({ enabled: true, port: 3101 }, on)).toMatchObject({
      enabled: true,
      port: 3101,
      address: "http://127.0.0.1:3101",
      restartRequired: false,
    });
    expect(triggersView({ enabled: false, port: 3101 }, off)).toMatchObject({
      address: null,
      restartRequired: false,
    });
  });

  it("asks for a restart when the saved choice is not what is running", () => {
    expect(triggersView({ enabled: true, port: 3101 }, off).restartRequired).toBe(true);
    expect(triggersView({ enabled: false, port: 3101 }, on).restartRequired).toBe(true);
    expect(triggersView({ enabled: true, port: 4000 }, on).restartRequired).toBe(true);
  });

  it("does not ask for a restart for a port that does not matter while it is off", () => {
    expect(triggersView({ enabled: false, port: 4000 }, off).restartRequired).toBe(false);
  });

  it("leaves it to the environment when NEURONS_HOOKS_PORT decides", () => {
    const view = triggersView(
      { enabled: false, port: 3101 },
      appliedFrom({ port: 3200, host: "127.0.0.1" }, "environment"),
    );
    expect(view).toMatchObject({
      environment: true,
      address: "http://127.0.0.1:3200",
      restartRequired: false,
    });
  });

  it("carries the reason the choice is not running", () => {
    const failed = appliedFrom(undefined, "app", "A porta está ocupada.");
    expect(triggersView({ enabled: true, port: 3101 }, failed)).toMatchObject({
      problem: "A porta está ocupada.",
      address: null,
      restartRequired: true,
    });
  });
});

describe("startWithTriggersFallback", () => {
  const withHooks = { hooks: { port: 3101 }, name: "x" };
  const portTaken = new Error(
    "Não foi possível abrir a porta dos gatilhos (127.0.0.1:3101): listen EADDRINUSE",
  );

  it("starts as asked when the port opens", async () => {
    const start = vi.fn().mockResolvedValue("servidor");
    await expect(startWithTriggersFallback(withHooks, true, start)).resolves.toEqual({
      server: "servidor",
    });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("starts again with the triggers off when only the port could not be opened, and says why", async () => {
    const start = vi.fn().mockRejectedValueOnce(portTaken).mockResolvedValueOnce("servidor");

    const result = await startWithTriggersFallback(withHooks, true, start);

    expect(result.server).toBe("servidor");
    expect(result.problem).toContain("3101");
    expect(start).toHaveBeenNthCalledWith(2, { name: "x" }); // no hooks the second time
  });

  it("does not hide any other failure", async () => {
    const start = vi.fn().mockRejectedValue(new Error("A pasta de dados está em uso."));
    await expect(startWithTriggersFallback(withHooks, true, start)).rejects.toThrow("em uso");
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does not turn off a port the environment asked for", async () => {
    const start = vi.fn().mockRejectedValue(portTaken);
    await expect(startWithTriggersFallback(withHooks, false, start)).rejects.toBe(portTaken);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does not retry when there were no triggers to turn off", async () => {
    const start = vi.fn().mockRejectedValue(portTaken);
    await expect(startWithTriggersFallback({ name: "x" }, true, start)).rejects.toBe(portTaken);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
