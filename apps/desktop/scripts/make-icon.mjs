// The approved transparent artwork is shared with the web app. electron-builder's
// pinned converter produces the native formats without redrawing the mark.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder"));
const { convertIcon } = builderRequire("app-builder-lib/out/util/iconConverter.js");
const source = fileURLToPath(new URL("../../web/public/neurons-icon.png", import.meta.url));
const outDir = fileURLToPath(new URL("../build/", import.meta.url));
mkdirSync(outDir, { recursive: true });
copyFileSync(source, fileURLToPath(new URL("../build/icon.png", import.meta.url)));
for (const format of ["ico", "icns"]) {
  const result = await convertIcon({
    sources: [source],
    fallbackSources: [],
    roots: [],
    format,
    outDir,
  });
  if (!result.icons.length || result.isFallback)
    throw new Error(`Falha ao converter o ícone para ${format}.`);
  console.log(`Ícone ${format} gravado em ${outDir}`);
}
