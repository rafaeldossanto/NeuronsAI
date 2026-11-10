import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { testConfig } from "../shared/config/testing/test-config.js";
import { modelProviders } from "./model-providers.js";

async function listening() {
  let hits = 0;
  const server = createServer((_request, response) => {
    hits++;
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    hits: () => hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const ask = (config: ReturnType<typeof testConfig>) =>
  modelProviders(config)
    .createSession("openai-compatible", "model", "local", "low")
    .respond("briefing", [], new AbortController().signal);

it("registers openai-compatible only when the operator configured an endpoint", () => {
  expect(() =>
    modelProviders(testConfig()).createSession("openai-compatible", "m", "k", "low"),
  ).toThrow("NEURONS_OPENAI_COMPATIBLE_BASE_URL");
  expect(() => modelProviders(testConfig()).createSession("nenhum", "m", "k", "low")).toThrow(
    "Unsupported provider",
  );
});

it("keeps the compatible endpoint away from loopback on public profiles", async () => {
  const target = await listening();
  try {
    await expect(
      ask(
        testConfig({
          compatibleBaseUrl: target.url,
          outbound: { allowedPorts: [80, 443], allowHosts: [] },
        }),
      ),
    ).rejects.toThrow();
    expect(target.hits()).toBe(0);
  } finally {
    await target.close();
  }
}, 30000);

it("reaches a local endpoint on the local profile, which has no outbound policy", async () => {
  const target = await listening();
  try {
    await ask(testConfig({ compatibleBaseUrl: target.url })).catch(() => undefined);
    expect(target.hits()).toBeGreaterThan(0);
  } finally {
    await target.close();
  }
}, 30000);
