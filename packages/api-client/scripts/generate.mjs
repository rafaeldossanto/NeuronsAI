// Generates the typed client of the API, or checks that what is committed is up to date.
//
//   node scripts/generate.mjs           writes openapi.json and src/schema.gen.ts
//   node scripts/generate.mjs --check   changes nothing; exits 1 when either file is stale
//
// The OpenAPI document comes from the server's code (apps/server/src/api/openapi/emit-cli.ts), and
// the types from the document (openapi-typescript), so a changed contract on the server cannot
// reach the client without this being run.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const root = new URL("../", import.meta.url);
const serverDirectory = fileURLToPath(new URL("../../apps/server/", root));
const targets = {
  document: new URL("openapi.json", root),
  types: new URL("src/schema.gen.ts", root),
};

const check = process.argv.includes("--check");

/** Text compared without caring how the checkout ended its lines. */
const normalize = (text) => text.replaceAll("\r\n", "\n");

function emitDocument() {
  return execFileSync(process.execPath, ["--import", "tsx", "src/api/openapi/emit-cli.ts"], {
    cwd: serverDirectory,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
}

const document = emitDocument();
const types = `${astToString(await openapiTS(JSON.parse(document)))}\n`;
const fresh = { document, types };

const stale = [];
for (const [name, url] of Object.entries(targets)) {
  const current = await readFile(url, "utf8").catch(() => undefined);
  if (current !== undefined && normalize(current) === normalize(fresh[name])) continue;
  if (check) stale.push(fileURLToPath(url));
  else await writeFile(url, fresh[name]);
}

if (stale.length > 0) {
  console.error(
    `O cliente da API está desatualizado: ${stale.join(", ")}.\nRode "pnpm api:generate" e faça o commit do resultado.`,
  );
  process.exit(1);
}
console.log(check ? "Cliente da API em dia." : "Cliente da API gerado.");
