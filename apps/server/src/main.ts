import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { createApp } from "./create-app.js";
import { ConfigError, LISTEN_HOST, loadConfig } from "./shared/config/app-config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.port, LISTEN_HOST);
  new Logger("Bootstrap").log(
    `NeuronsAI server (modo ${config.mode}) em http://${LISTEN_HOST}:${config.port}`,
  );
}

main().catch((error: unknown) => {
  // A configuration problem is the user's to fix: show it plainly, without a stack trace.
  console.error(error instanceof ConfigError ? error.message : error);
  process.exitCode = 1;
});
