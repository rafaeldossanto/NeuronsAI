/**
 * Manual check of the `--permission-mode` values the runtimes accept (T08), with the REAL Claude
 * Code CLI. Each mode starts one PTY agent and one stream-json agent in a scratch folder and prints
 * what the terminal's footer shows; NO prompt is sent, so nothing is spent from the subscription.
 * Run it by hand: `pnpm --filter @neurons/server test:e2e:permission-modes`.
 *
 * It exists because the list of accepted modes (`claude-args.ts`) is copied from `claude --help`
 * of one CLI version and only the real CLI can say whether it still starts with each of them.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentNode } from "@neurons/graph-schema";
import { isTerminalRuntime, type AgentCommunication } from "@neurons/agent-runtimes";
import { TerminalRuntimeFactory, TerminalScreen } from "@neurons/agent-runtimes/claude";
import { loadConfig } from "../src/shared/config/app-config.js";

const MODES = ["manual", "acceptEdits", "plan", "dontAsk", "auto"];
const config = loadConfig();
const log = (line: string) => console.log(line);

const communication = {} as AgentCommunication;

function node(mode: "pty" | "stream-json", permissionMode: string, cwd: string): AgentNode {
  return {
    id: `agente-${mode}-${permissionMode}`,
    type: "agent",
    position: { x: 0, y: 0 },
    name: "Teste",
    role: "Só abre e fecha",
    instructions: "Não faça nada.",
    effort: "low",
    runtime: {
      kind: "terminal",
      cli: "claude",
      mode,
      args: ["--model", "haiku", "--permission-mode", permissionMode],
      cwd,
    },
  } as unknown as AgentNode;
}

async function main(): Promise<number> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "neurons-modes-"));
  const factory = new TerminalRuntimeFactory({
    askTimeoutMs: 60_000,
    cli: { ...(config.claudeBin && { configuredBinary: config.claudeBin }) },
    logger: { warn: (m) => log(`  AVISO ${m}`), error: (m) => log(`  ERRO ${m}`) },
    terminal: { trustWorkingDirectory: true },
  });
  let failed = 0;
  try {
    for (const mode of ["pty", "stream-json"] as const) {
      for (const permissionMode of MODES) {
        const runtime = factory.create(node(mode, permissionMode, cwd), communication);
        const screen = new TerminalScreen(120, 40);
        if (isTerminalRuntime(runtime)) runtime.onOutput((chunk) => screen.write(chunk));
        const t0 = Date.now();
        try {
          await runtime.start(`# Você é "Teste"`);
          // The footer repaints after the boot; give it a moment.
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const lines = screen.text().split("\n").filter(Boolean).slice(-3).join(" | ");
          log(
            `${mode} / ${permissionMode}: OK em ${((Date.now() - t0) / 1000).toFixed(1)} s (${runtime.state})${isTerminalRuntime(runtime) ? ` rodapé: ${lines}` : ""}`,
          );
        } catch (error) {
          failed++;
          log(
            `${mode} / ${permissionMode}: FALHOU: ${error instanceof Error ? error.message : String(error)}`,
          );
          if (isTerminalRuntime(runtime)) log(`  tela: ${screen.text().slice(-600)}`);
        } finally {
          await runtime.stop();
          screen.dispose();
        }
      }
    }
  } finally {
    await rm(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  }
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
