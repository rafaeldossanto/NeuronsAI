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

  it("fecha o cadastro por padrão e lê as listas de permissão", () => {
    expect(loadConfig(env).auth?.signup).toEqual({
      open: false,
      allowedDomains: [],
      allowedEmails: [],
    });
    const signup = loadConfig({
      ...env,
      NEURONS_SIGNUP_ALLOWED_DOMAINS: "Exemplo.com, @time.example.com",
      NEURONS_SIGNUP_ALLOWED_EMAILS: "Dono@Outro.com",
    }).auth?.signup;
    expect(signup).toEqual({
      open: false,
      allowedDomains: ["exemplo.com", "time.example.com"],
      allowedEmails: ["dono@outro.com"],
    });
    expect(loadConfig({ ...env, NEURONS_SIGNUP_OPEN: "true" }).auth?.signup.open).toBe(true);
  });
  it.each([
    { NEURONS_SIGNUP_ALLOWED_DOMAINS: "nao-e-dominio" },
    { NEURONS_SIGNUP_ALLOWED_EMAILS: "sem-arroba" },
    { NEURONS_SIGNUP_OPEN: "talvez" },
  ])("recusa lista de cadastro inválida: %o", (change) => {
    expect(() => loadConfig({ ...env, ...change })).toThrow(ConfigError);
  });
});
