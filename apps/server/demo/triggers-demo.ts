/**
 * Demo and acceptance test of the external triggers (T16a), with the fake Claude Code CLI (free):
 * starts the server in this process with the hooks port on, publishes `two-terminals.json` with a
 * webhook trigger and a `* * * * *` schedule, and then
 *
 *   1. calls the webhook signed (202), with a wrong signature, repeated and expired (all 401);
 *   2. waits for the schedule to fire (up to a minute) and then to fire again the minute after,
 *      with a new run. (The fake CLI ends each run at once, so nothing overlaps here; skipping a
 *      moment while the previous run still goes is covered by the scheduler's unit tests.)
 *
 * It takes about two minutes. The exit code says whether everything happened.
 *
 *   pnpm --filter @neurons/server demo:triggers
 */
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiClient } from "@neurons/api-client";
import { createApp } from "../src/create-app.js";
import { HooksServer } from "../src/triggers/hooks-server.js";
import { loadConfig, type AppConfig } from "../src/shared/config/app-config.js";

const FIXTURE = fileURLToPath(
  new URL("../../../packages/graph-schema/examples/two-terminals.json", import.meta.url),
);
const FAKE_CLAUDE = fileURLToPath(
  new URL("../../../packages/agent-runtimes/test-fixtures/fake-claude.mjs", import.meta.url),
);

const WEBHOOK = "gatilho-webhook";
const SCHEDULE = "gatilho-agenda";
/** What the webhook body says to the fake CLI: wait, ask the reviewer and finish. */
const BODY = "!sleep 1500\n!ask Revisor !reply certo\n!finish resumo validado: $last";

const startedAt = Date.now();
const log = (line: string) =>
  console.log(`[${((Date.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}`);

const sign = (secret: string, timestamp: string, body: string) =>
  `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

async function post(url: string, body: string, headers: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    body,
    headers: { "content-type": "text/plain", ...headers },
  });
  return { status: response.status, text: await response.text() };
}

const nowSec = () => String(Math.floor(Date.now() / 1000));

function demoConfig(dataDir: string): AppConfig {
  return {
    ...loadConfig({}),
    mode: "all",
    profile: "local",
    port: 0,
    dataDir,
    database: { kind: "embedded" },
    // The webhook secret is stored encrypted: a throwaway key for this run.
    masterKey: randomBytes(32),
    askTimeoutMs: 60_000,
    hooks: { port: 0, host: "127.0.0.1", maxBodyBytes: 256 * 1024, ratePerMinute: 60 },
    claudeCommand: { command: process.execPath, args: [FAKE_CLAUDE] },
  };
}

async function loadGraph(graphId: string, workdir: string) {
  const fixture = JSON.parse(await readFile(FIXTURE, "utf8")) as {
    nodes: { type: string; runtime?: Record<string, unknown> }[];
  };
  const nodes = fixture.nodes
    .filter((node) => node.type !== "trigger")
    .map((node) =>
      node.type === "agent" && node.runtime
        ? { ...node, runtime: { ...node.runtime, cwd: workdir } }
        : node,
    );
  const trigger = (id: string, extra: object) => ({
    id,
    type: "trigger",
    position: { x: 0, y: 0 },
    target: "agente-pesquisador",
    ...extra,
  });
  return {
    ...fixture,
    id: graphId,
    nodes: [
      trigger(WEBHOOK, { kind: "webhook" }),
      trigger(SCHEDULE, { kind: "schedule", cron: "* * * * *", timezone: "America/Sao_Paulo" }),
      ...nodes,
    ],
  };
}

async function main(): Promise<number> {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "neurons-triggers-"));
  const workdir = path.join(scratch, "work");
  await mkdir(workdir);
  const app = await createApp(demoConfig(path.join(scratch, "data")));
  const problems: string[] = [];
  const check = (ok: boolean, what: string) => {
    log(`${ok ? "ok  " : "ERRO"} ${what}`);
    if (!ok) problems.push(what);
  };
  try {
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    const api = createApiClient(`http://127.0.0.1:${String(address.port)}`);
    const hooksPort = app.get(HooksServer).port!;
    log(`API em :${String(address.port)} e porta dos gatilhos em :${String(hooksPort)}`);

    const created = await api.POST("/graphs", { body: { name: "Demo: gatilhos" } });
    const graphId = created.data!.id;
    const published = await api.POST("/graphs/{id}/versions", {
      params: { path: { id: graphId } },
      body: { definition: (await loadGraph(graphId, workdir)) as never },
    });
    if (!published.data) throw new Error(`publicar: ${JSON.stringify(published.error)}`);
    log(`grafo publicado (versão ${String(published.data.version)})`);

    const secretReply = await api.POST("/graphs/{id}/triggers/{triggerId}/secret", {
      params: { path: { id: graphId, triggerId: WEBHOOK } },
    });
    if (!secretReply.data) throw new Error(`segredo: ${JSON.stringify(secretReply.error)}`);
    const secret = secretReply.data.secret;
    const url = `http://127.0.0.1:${String(hooksPort)}${secretReply.data.state.hookPath!}`;
    for (const triggerId of [WEBHOOK, SCHEDULE]) {
      await api.PUT("/graphs/{id}/triggers/{triggerId}/enabled", {
        params: { path: { id: graphId, triggerId } },
        body: { enabled: true },
      });
    }
    const schedule = await api.GET("/graphs/{id}/triggers/{triggerId}", {
      params: { path: { id: graphId, triggerId: SCHEDULE } },
    });
    log(`gatilhos ativos; a agenda dispara em ${String(schedule.data?.nextRunAt)}`);

    // 1. The webhook.
    const ts = nowSec();
    const accepted = await post(url, BODY, {
      "x-neurons-timestamp": ts,
      "x-neurons-signature": sign(secret, ts, BODY),
    });
    check(
      accepted.status === 202,
      `POST assinado aceito (${String(accepted.status)} ${accepted.text})`,
    );
    const replay = await post(url, BODY, {
      "x-neurons-timestamp": ts,
      "x-neurons-signature": sign(secret, ts, BODY),
    });
    check(replay.status === 401, `o mesmo POST de novo recusado (${String(replay.status)})`);
    const wrong = await post(url, BODY, {
      "x-neurons-timestamp": nowSec(),
      "x-neurons-signature": `sha256=${"0".repeat(64)}`,
    });
    check(wrong.status === 401, `assinatura errada recusada (${String(wrong.status)})`);
    const old = String(Number(nowSec()) - 600);
    const expired = await post(url, BODY, {
      "x-neurons-timestamp": old,
      "x-neurons-signature": sign(secret, old, BODY),
    });
    check(expired.status === 401, `assinatura vencida recusada (${String(expired.status)})`);
    const apiOnHooks = await fetch(`http://127.0.0.1:${String(hooksPort)}/graphs`);
    check(
      apiOnHooks.status === 404,
      `a API não responde na porta dos gatilhos (${String(apiOnHooks.status)})`,
    );

    // 2. The schedule: fires, then the next minute is skipped while that run is still going.
    const lastRun = async () =>
      (
        await api.GET("/graphs/{id}/triggers/{triggerId}", {
          params: { path: { id: graphId, triggerId: SCHEDULE } },
        })
      ).data?.lastRun ?? null;
    const waitFor = async (outcome: string, timeoutMs: number, notRunId?: string | null) => {
      const deadline = Date.now() + timeoutMs;
      let previous = "";
      while (Date.now() < deadline) {
        const run = await lastRun();
        const text = run ? `${run.outcome} ${run.at}` : "";
        if (text !== previous && run) log(`agenda: ${run.outcome} em ${run.at} ${run.note ?? ""}`);
        previous = text;
        if (run?.outcome === outcome && run.runId !== notRunId) return true;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      return false;
    };
    log("esperando a agenda disparar (até 1 min)…");
    check(await waitFor("started", 75_000), "a agenda disparou no horário");
    const firstRunId = (await lastRun())?.runId;
    log("esperando o minuto seguinte (até 1 min)…");
    check(
      await waitFor("started", 75_000, firstRunId),
      "a agenda disparou de novo no minuto seguinte, com outra execução",
    );

    const runs = await api.GET("/runs", { params: { query: { graphId } } });
    log(`execuções deste grafo: ${String(runs.data?.total)}`);
    await api.PUT("/graphs/{id}/triggers/{triggerId}/enabled", {
      params: { path: { id: graphId, triggerId: SCHEDULE } },
      body: { enabled: false },
    });
  } finally {
    await app.close();
    await rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  }
  if (problems.length > 0) {
    console.error(`\nFalhou: ${problems.join("; ")}`);
    return 1;
  }
  console.log("\nTudo certo.");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
