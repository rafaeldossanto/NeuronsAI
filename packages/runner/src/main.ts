#!/usr/bin/env node
import { loadRunnerConfig, RunnerConfigError } from "./config.js";
import { startRunner } from "./start-runner.js";

const log = (line: string) => console.log(`[runner] ${line}`);

function main(): void {
  const config = loadRunnerConfig();
  const runner = startRunner({
    url: config.url,
    token: config.token,
    name: config.name,
    ...(config.claudeBin && { claudeBin: config.claudeBin }),
    logger: {
      warn: (message) => console.warn(`[runner] ${message}`),
      error: (message) => console.error(`[runner] ${message}`),
    },
    onStatus: (status) => {
      switch (status.kind) {
        case "connecting":
          return log(`conectando a ${new URL(config.url).host}...`);
        case "connected":
          return log("conectado.");
        case "disconnected":
          return log(
            `conexão perdida; nova tentativa em ${Math.round(status.retryInMs / 1000)} s.`,
          );
        case "refused":
          console.error(`[runner] o servidor recusou este runner: ${status.message}`);
          process.exitCode = 1;
          void runner.stop();
      }
    },
  });

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    log("encerrando...");
    void runner.stop().then(() => process.exit());
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

try {
  main();
} catch (error) {
  // A configuration problem is the user's to fix: show it plainly, without a stack trace.
  console.error(error instanceof RunnerConfigError ? error.message : error);
  process.exitCode = 1;
}
