import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { importMemoryFiles } from "./memory-import";

function file(name: string, bytes: Uint8Array, relativePath = "") {
  const contents = Uint8Array.from(bytes);
  const result = new File([contents.buffer], name);
  Object.defineProperties(result, {
    arrayBuffer: { value: () => Promise.resolve(contents.buffer) },
    webkitRelativePath: { value: relativePath },
  });
  return result;
}

describe("importação de cofres", () => {
  it("extrai ZIP preservando notas, links e anexos, sem importar a configuração do Obsidian", async () => {
    const archive = zipSync({
      "Cofre/Projeto/Plano.md": strToU8("# Plano\n[[Decisões]]"),
      "Cofre/Anexos/referencia.bin": new Uint8Array([0, 255, 42]),
      "Cofre/.obsidian/workspace.json": strToU8("{}"),
    });
    const files = await importMemoryFiles([file("cofre.zip", archive)]);
    expect(files.map((entry) => entry.path)).toEqual(["Projeto/Plano.md", "Anexos/referencia.bin"]);
    expect(
      new TextDecoder().decode(Uint8Array.from(atob(files[0]!.data), (c) => c.charCodeAt(0))),
    ).toBe("# Plano\n[[Decisões]]");
    expect(files[1]!.data).toBe("AP8q");
  });

  it("recusa ZIP com caminhos repetidos inclusive quando diferem apenas em maiúsculas", async () => {
    const archive = zipSync({ "Nota.md": strToU8("A"), "nota.md": strToU8("B") });
    await expect(importMemoryFiles([file("cofre.zip", archive)])).rejects.toThrow("mesmo caminho");
  });

  it("mantém subpastas da pasta selecionada e recusa arquivos acima do limite", async () => {
    expect(
      await importMemoryFiles([
        file("Plano.md", strToU8("[[Decisões]]"), "Cofre/Projeto/Plano.md"),
      ]),
    ).toEqual([
      { path: "Projeto/Plano.md", data: btoa(String.fromCharCode(...strToU8("[[Decisões]]"))) },
    ]);
    await expect(
      importMemoryFiles([file("anexo.bin", new Uint8Array(20 * 1024 * 1024 + 1))]),
    ).rejects.toThrow("20 MB");
  });
});
