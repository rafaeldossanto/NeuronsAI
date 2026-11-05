import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./app-config.js";

describe("configuração da guarda de saída (SSRF)", () => {
  it("não restringe nada no perfil local", () => {
    expect(loadConfig({}).outbound).toBeUndefined();
    expect(
      loadConfig({ NEURONS_PROFILE: "local", NEURONS_OUTBOUND_ALLOW_HOSTS: "api.interna" })
        .outbound,
    ).toBeUndefined();
  });

  it.each(["hybrid", "hosted"])(
    "restringe as ferramentas no perfil %s (portas 80 e 443)",
    (profile) => {
      expect(loadConfig({ NEURONS_PROFILE: profile }).outbound).toEqual({
        allowedPorts: [80, 443],
        allowHosts: [],
      });
    },
  );

  it("lê as portas e a lista de permissão da configuração", () => {
    const outbound = loadConfig({
      NEURONS_PROFILE: "hybrid",
      NEURONS_OUTBOUND_ALLOWED_PORTS: "443, 8443,443",
      NEURONS_OUTBOUND_ALLOW_HOSTS: "API.Interna.Exemplo.com, *.parceiro.com, 10.0.0.5",
    }).outbound;
    expect(outbound).toEqual({
      allowedPorts: [443, 8443],
      allowHosts: ["api.interna.exemplo.com", "*.parceiro.com", "10.0.0.5"],
    });
  });

  it.each([
    { NEURONS_OUTBOUND_ALLOWED_PORTS: "http" },
    { NEURONS_OUTBOUND_ALLOWED_PORTS: "0" },
    { NEURONS_OUTBOUND_ALLOWED_PORTS: "70000" },
    { NEURONS_OUTBOUND_ALLOW_HOSTS: "https://api.exemplo.com" },
    { NEURONS_OUTBOUND_ALLOW_HOSTS: "api.exemplo.com/caminho" },
  ])("recusa valores inválidos: %o", (change) => {
    expect(() => loadConfig({ NEURONS_PROFILE: "hybrid", ...change })).toThrow(ConfigError);
  });
});
