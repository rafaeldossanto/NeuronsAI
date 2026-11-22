import { describe, expect, it } from "vitest";
import { readAvatarImage } from "./avatar-image";

describe("seleção de imagem do perfil", () => {
  it("recusa formatos incompatíveis antes de ler o arquivo", async () => {
    await expect(
      readAvatarImage(new File(["svg"], "icone.svg", { type: "image/svg+xml" })),
    ).rejects.toThrow("PNG, JPG ou WebP");
  });
  it("recusa imagens acima do limite", async () => {
    await expect(
      readAvatarImage(
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], "foto.png", { type: "image/png" }),
      ),
    ).rejects.toThrow("até 5 MB");
  });
});
