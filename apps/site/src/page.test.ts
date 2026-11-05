import page from "../index.html?raw";
import { expect, it } from "vitest";

it("mantém CSP estrita, recursos externos, lista inativa e entrada do modelador em nova aba", () => {
  expect(page).toContain("script-src 'self'");
  expect(page).toContain("style-src 'self'");
  expect(page).toContain("connect-src 'self' https://api.github.com");
  expect(page).not.toMatch(/unsafe-(?:inline|eval)|<style\b|\sstyle=|\son\w+=/i);
  expect([...page.matchAll(/<script\b[^>]*>/g)].every(([tag]) => tag.includes("src="))).toBe(true);
  expect(page).toMatch(/href="__MODELER_URL__"\s+target="_blank"/);
  expect(page).toMatch(/id="waitlist-email"[\s\S]*?disabled/);
  expect(page).toContain('lang="pt-BR"');
  expect(page).toContain('property="og:locale" content="pt_BR"');
});
