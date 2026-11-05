import { describe, expect, it } from "vitest";
import { SignupPolicy } from "./signup-policy.js";

const policy = new SignupPolicy({
  open: false,
  allowedDomains: ["exemplo.com"],
  allowedEmails: ["dona@fora.com"],
});

describe("SignupPolicy", () => {
  it("admite o e-mail listado e o domínio listado, sem diferenciar maiúsculas", () => {
    expect(policy.allows("dona@fora.com")).toBe(true);
    expect(policy.allows("Dona@Fora.com")).toBe(true);
    expect(policy.allows("qualquer@exemplo.com")).toBe(true);
    expect(policy.allows("QUALQUER@EXEMPLO.COM")).toBe(true);
  });

  it("recusa quem não está na lista, subdomínios e domínios parecidos", () => {
    expect(policy.allows("outro@fora.com")).toBe(false);
    expect(policy.allows("alguem@sub.exemplo.com")).toBe(false);
    expect(policy.allows("alguem@meuexemplo.com")).toBe(false);
    expect(policy.allows("exemplo.com@evil.com")).toBe(false);
  });

  it("sem e-mail verificado só admite quando o cadastro está aberto", () => {
    expect(policy.allows(undefined)).toBe(false);
    expect(SignupPolicy.closed().allows("qualquer@exemplo.com")).toBe(false);
    expect(SignupPolicy.open().allows(undefined)).toBe(true);
  });
});
