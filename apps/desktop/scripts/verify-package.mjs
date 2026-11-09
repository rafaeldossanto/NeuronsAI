import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Detects files modified while the builder was reading them, before launching the executable. */
export function verifyPackage(archive) {
  const require = createRequire(import.meta.url);
  const builder = createRequire(require.resolve("electron-builder"));
  const dependencies = createRequire(builder.resolve("app-builder-lib"));
  const asar = dependencies("@electron/asar");
  const semver = dependencies("semver");
  const pkg = JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"));
  if (!pkg.main || typeof pkg.main !== "string") throw new Error("Pacote sem ponto de entrada.");
  asar.statFile(archive, pkg.main);
  let checked = 0;
  const modules = [];
  for (const entry of asar.listPackage(archive)) {
    const name = entry.replaceAll("\\", "/").replace(/^\//, "");
    const nativeName = name.split("/").join(path.sep);
    if (
      /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(name) ||
      name === "package.json"
    )
      modules.push({
        name,
        pkg: JSON.parse(asar.extractFile(archive, nativeName).toString("utf8")),
      });
    const info = asar.statFile(archive, nativeName, false);
    if (info.unpacked || !info.integrity || info.size === undefined) continue;
    const hash = createHash(info.integrity.algorithm)
      .update(asar.extractFile(archive, nativeName))
      .digest("hex");
    if (hash !== info.integrity.hash)
      throw new Error(
        `Integridade inválida no pacote: ${name}. Recompile e empacote sem modificar os arquivos durante a operação.`,
      );
    checked++;
  }
  if (checked === 0) throw new Error("O pacote não contém hashes de integridade.");
  // Workspace dependencies omitted by the package collector otherwise fail only at startup.
  for (const module of modules) {
    for (const dependency of Object.keys(module.pkg.dependencies ?? {})) {
      if (module.pkg.optionalDependencies?.[dependency]) continue;
      let directory = path.posix.dirname(module.name);
      let found = false;
      for (;;) {
        const candidate = path.posix.join(directory, "node_modules", dependency, "package.json");
        try {
          asar.statFile(archive, candidate.split("/").join(path.sep));
          const installed = JSON.parse(
            asar.extractFile(archive, candidate.split("/").join(path.sep)).toString("utf8"),
          );
          const required = module.pkg.dependencies[dependency];
          if (semver.validRange(required) && !semver.satisfies(installed.version, required))
            throw new Error("incompatible version");
          found = true;
          break;
        } catch {
          /* Search the next ancestor, as Node does. */
        }
        const parent = path.posix.dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
      if (!found)
        throw new Error(`Dependência ausente no pacote: ${module.pkg.name} → ${dependency}`);
    }
  }
  return { name: pkg.name, version: pkg.version, checked };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const archive = process.argv[2];
  if (!archive) throw new Error("Informe o caminho de resources/app.asar.");
  console.log(JSON.stringify(verifyPackage(path.resolve(archive))));
}
