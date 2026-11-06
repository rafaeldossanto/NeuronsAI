import { describe, expect, it, vi } from "vitest";
import { SecretsController } from "./secrets.controller.js";
import type { SecretsService } from "./secrets.service.js";

describe("SecretsController.write", () => {
  const build = () => {
    const set = vi.fn(() => Promise.resolve());
    return { controller: new SecretsController({ set } as unknown as SecretsService), set };
  };

  it("grava o segredo de uma pessoa", async () => {
    const { controller, set } = build();
    await controller.write({ name: "anthropic" }, { value: "valor" });
    expect(set).toHaveBeenCalledWith("anthropic", "valor");
  });

  it("reserva os nomes webhook.*, onde o servidor guarda a chave dos gatilhos", async () => {
    const { controller, set } = build();
    await expect(
      controller.write({ name: "webhook.AAAAAAAAAAAAAAAAAAAAAA" }, { value: "x" }),
    ).rejects.toMatchObject({ code: "reserved_secret_name", kind: "invalid" });
    expect(set).not.toHaveBeenCalled();
  });
});
