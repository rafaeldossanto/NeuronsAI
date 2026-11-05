// Acceptance test of T17. Always uses the fake CLI; there is intentionally no real-account mode.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { instantiateTemplate, listTemplates, validateGraph } from "../dist/index.js";

const require = createRequire(new URL("../../../apps/server/package.json", import.meta.url));
require("reflect-metadata");
const { createApp } = await import("../../../apps/server/dist/create-app.js");
const { loadConfig } = await import("../../../apps/server/dist/shared/config/app-config.js");
const { Logger } = require("@nestjs/common");
Logger.overrideLogger(false);
const scratch = path.resolve(await mkdtemp(path.join(os.tmpdir(), "neurons-t17-")));
const cwd = path.join(scratch, "work");
await mkdir(cwd);
const fake = fileURLToPath(
  new URL("../../agent-runtimes/test-fixtures/fake-claude.mjs", import.meta.url),
);
const app = await createApp({
  ...loadConfig({}),
  profile: "local",
  dataDir: path.join(scratch, "data"),
  askTimeoutMs: 5_000,
  usageFlushMs: 0,
  claudeCommand: { command: process.execPath, args: [fake] },
});
try {
  await app.listen(0, "127.0.0.1");
  const origin = await app.getUrl();
  const api = async (method, url, body) => {
    const response = await fetch(origin + url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body && { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    assert.equal(response.ok, true, `${method} ${url}: ${JSON.stringify(data)}`);
    return data;
  };
  let researchVersion;
  for (const template of listTemplates()) {
    const created = await api("POST", "/graphs", { name: template.name });
    const graph = instantiateTemplate(template.id, { projectId: created.id, cwd });
    assert.notEqual(graph.id, template.graph.id);
    assert.equal(validateGraph(graph).ok, true);
    await api("PATCH", `/graphs/${created.id}`, { name: graph.name, draft: graph });
    const reopened = await api("GET", `/graphs/${created.id}`);
    assert.deepEqual(reopened.draft, graph);
    assert.equal(reopened.latestVersion, null);
    const version = await api("POST", `/graphs/${created.id}/versions`, {});
    assert.equal(version.version, 1);
    console.log(
      `T17: ${template.id} criado com id próprio, reaberto e publicado explicitamente no banco de teste.`,
    );
    if (template.id === "research-review") researchVersion = version;
  }
  assert(researchVersion);
  const run = await api("POST", "/runs", {
    graphVersionId: researchVersion.id,
    input: "!ask Revisor !reply certo\n!finish resumo validado: $last",
  });
  let detail;
  const deadline = Date.now() + 45_000;
  do {
    detail = await api("GET", `/runs/${run.id}`);
    if (["succeeded", "failed", "cancelled"].includes(detail.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  assert.equal(detail.status, "succeeded", JSON.stringify(detail));
  assert.equal(detail.finish?.reason, "finished");
  assert.match(detail.finish?.result, /resumo validado: certo/);
  const events = await api("GET", `/runs/${run.id}/events?limit=200`);
  const messages = events.items.filter((event) => event.type === "MessageSent");
  assert(
    messages.some(
      (event) =>
        event.payload.from === "Pesquisador" &&
        event.payload.to === "Revisor" &&
        event.payload.kind === "ask",
    ),
  );
  assert(
    messages.some(
      (event) =>
        event.payload.from === "Revisor" &&
        event.payload.to === "Pesquisador" &&
        event.payload.kind === "reply",
    ),
  );
  console.log(
    "T17 OK: novo id → rascunho → reabertura → publicação explícita → Pesquisador pergunta → Revisor responde → execução concluída. CLI de mentira; nenhuma chamada paga.",
  );
} finally {
  await app.close();
  assert.equal(path.dirname(scratch), path.resolve(os.tmpdir()));
  assert(path.basename(scratch).startsWith("neurons-t17-"));
  await rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
}
