import { describe, expect, it } from "vitest";
import { readSiteConfig } from "./config.js";

describe("lista de espera", () => {
  it("fica desligada por padrão, mesmo com URL sem opt-in", () => {
    expect(readSiteConfig({}).waitlistUrl).toBeNull();
    expect(
      readSiteConfig({ VITE_WAITLIST_URL: "https://example.com/lista" }).waitlistUrl,
    ).toBeNull();
  });
  it("só habilita um destino HTTPS configurado explicitamente", () => {
    expect(
      readSiteConfig({
        VITE_WAITLIST_ENABLED: "true",
        VITE_WAITLIST_URL: "https://example.com/lista",
      }).waitlistUrl,
    ).toBe("https://example.com/lista");
    expect(
      readSiteConfig({ VITE_WAITLIST_ENABLED: "true", VITE_WAITLIST_URL: "javascript:alert(1)" })
        .waitlistUrl,
    ).toBeNull();
    expect(
      readSiteConfig({ VITE_WAITLIST_ENABLED: "true", VITE_WAITLIST_URL: "inválido" }).waitlistUrl,
    ).toBeNull();
  });
});
