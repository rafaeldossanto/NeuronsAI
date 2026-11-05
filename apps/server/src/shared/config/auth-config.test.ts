import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./app-config.js";

const env = {
  NEURONS_PUBLIC_ORIGIN: "https://neurons.example.invalid",
  NEURONS_GOOGLE_CLIENT_ID: "test",
  NEURONS_GOOGLE_CLIENT_SECRET: "placeholder",
  NEURONS_GOOGLE_REDIRECT_URI: "https://neurons.example.invalid/auth/google/callback",
  NEURONS_PROFILE: "hybrid",
  NEURONS_MASTER_KEY: randomBytes(32).toString("base64"),
};
describe("configuração de contas", () => {
  it("mantém o perfil local sem conta e exige todas as variáveis para configurar Google", () => {
    expect(loadConfig({}).auth).toBeUndefined();
    expect(() => loadConfig({ NEURONS_GOOGLE_CLIENT_ID: "test" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, NEURONS_PROFILE: "local" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, NEURONS_MASTER_KEY: "" })).toThrow(ConfigError);
    expect(loadConfig(env).auth?.publicOrigin).toBe(env.NEURONS_PUBLIC_ORIGIN);
  });
  it.each([
    { NEURONS_PUBLIC_ORIGIN: "http://public.example.invalid" },
    { NEURONS_PUBLIC_ORIGIN: "https://neurons.example.invalid/path" },
    { NEURONS_GOOGLE_REDIRECT_URI: "https://evil.invalid/auth/google/callback" },
    {
      NEURONS_GOOGLE_REDIRECT_URI: "https://neurons.example.invalid/auth/google/callback?next=evil",
    },
  ])("recusa origem/retorno inseguros: %o", (change) => {
    expect(() => loadConfig({ ...env, ...change })).toThrow(ConfigError);
  });
});
