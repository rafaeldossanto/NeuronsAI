import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { createApp } from "./create-app.js";
import { ConfigError, loadConfig } from "./shared/config/app-config.js";
import { isLoopbackHost } from "./shared/config/listen-config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.port, config.host);
  const logger = new Logger("Bootstrap");
  logger.log(`NeuronsAI server (modo ${config.mode}) em http://${config.host}:${config.port}`);
  if (!isLoopbackHost(config.host)) {
    logger.warn(
      "Escutando fora desta máquina e sem login: qualquer um que alcance a porta usa a API.",
    );
  }
}

main().catch((error: unknown) => {
  // A configuration problem is the user's to fix: show it plainly, without a stack trace.
  console.error(error instanceof ConfigError ? error.message : error);
  process.exitCode = 1;
});
