import { describe, expect, it } from "vitest";
import { instrument } from "../src/core/instrument.js";
import { summarizeInput } from "../src/core/summary.js";
import { InMemorySecretResolver, type Tool } from "../src/index.js";
import { testContext } from "./support.js";

// Not a real secret: a made-up value the tests look for in what a call reports.
const SECRET_VALUE = "valor-ficticio-do-segredo-9f3a";

describe("summarizeInput", () => {
  it("shows a secret as its name, the placeholder the agent wrote", () => {
    const summary = summarizeInput({ url: "https://api.exemplo.com", chave: "{{secret:API_KEY}}" });

    expect(summary).toContain("{{secret:API_KEY}}");
    expect(summary).toContain("https://api.exemplo.com");
  });

  it("cuts a long text, so one big field does not hide the rest", () => {
    const summary = summarizeInput({ texto: "x".repeat(5_000), depois: "visível" });

    expect(summary.length).toBeLessThan(300);
    expect(summary).toContain("visível");
    expect(summary).toContain("…");
  });

  it("cuts the whole summary and long lists", () => {
    const wide = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`campo${i}`, "abc"]));

    expect(summarizeInput(wide).length).toBeLessThanOrEqual(300);
    expect(summarizeInput({ itens: Array.from({ length: 50 }, (_, i) => i) })).toContain("… +40");
  });

  it("hides what sits under a key that looks like a credential, at any depth", () => {
    const summary = summarizeInput({
      a: { b: { Authorization: "Bearer abc", senha: 1, nota: "ok" } },
    });

    expect(summary).not.toContain("Bearer abc");
    expect(summary).toContain("[oculto]");
    expect(summary).toContain("ok");
  });

  it("survives what cannot be serialized and what is not an object", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(summarizeInput(circular)).toContain("…");
    expect(summarizeInput(42)).toBe("42");
    expect(summarizeInput(undefined)).toBe("undefined");
  });
});

describe("the summary reported for a call", () => {
  /** A tool that resolves the secrets it finds in its input, as the HTTP tool does. */
  const resolvingTool: Tool = {
    name: "chamada",
    description: "teste",
    inputSchema: {},
    async execute(input, ctx) {
      const text = JSON.stringify(input);
      for (const [, name] of text.matchAll(/\{\{secret:([A-Z_]+)\}\}/g)) {
        await ctx.secrets.resolve(name!);
      }
      return { ok: true, content: "feito", truncated: false };
    },
  };
  const secrets = new InMemorySecretResolver({ API_KEY: SECRET_VALUE });
  const call = async (input: unknown) => {
    const ctx = testContext({ secrets });
    await instrument(resolvingTool, { maxResultChars: 1_000 }).execute(input, ctx);
    return ctx.calls[0]!;
  };

  it("names the secret and never holds its value", async () => {
    const report = await call({ cabecalho: "Bearer {{secret:API_KEY}}" });

    expect(report.inputSummary).toContain("{{secret:API_KEY}}");
    expect(JSON.stringify(report)).not.toContain(SECRET_VALUE);
  });

  it("scrubs the value of a secret the call resolved even if the agent wrote it out in full", async () => {
    const report = await call({ cabecalho: "Bearer {{secret:API_KEY}}", copia: SECRET_VALUE });

    expect(JSON.stringify(report)).not.toContain(SECRET_VALUE);
    expect(report.inputSummary).toContain("[segredo]");
  });

  it("scrubs it from the report of a call that failed too", async () => {
    const failing: Tool = {
      ...resolvingTool,
      async execute(input, ctx) {
        await ctx.secrets.resolve("API_KEY");
        throw new Error(`falhou com ${SECRET_VALUE}`);
        void input;
      },
    };
    const ctx = testContext({ secrets });

    const result = await instrument(failing, { maxResultChars: 1_000 }).execute(
      { x: SECRET_VALUE },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(ctx.calls[0]).toMatchObject({ ok: false, errorCode: "INTERNAL_ERROR" });
    expect(JSON.stringify(ctx.calls)).not.toContain(SECRET_VALUE);
  });

  it("truncates a long text in the report", async () => {
    const report = await call({ texto: "y".repeat(10_000) });

    expect(report.inputSummary.length).toBeLessThanOrEqual(300);
  });
});
