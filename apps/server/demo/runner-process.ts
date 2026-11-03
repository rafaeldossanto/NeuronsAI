/**
 * The runner of the demo's `hybrid` profile, as its own process: what `neurons-runner` does, with
 * the fake CLI plugged in when asked (`--fake-claude <script>`), since the fake is code, not an
 * environment variable. The address and the token come from the environment, like the real one.
 * It leaves when its stdin closes, so the demo can end it without killing the CLIs it hosts.
 */
import { loadRunnerConfig, startRunner } from "@neurons/runner";

const fakeIndex = process.argv.indexOf("--fake-claude");
const fakeClaude = fakeIndex >= 0 ? process.argv[fakeIndex + 1] : undefined;

const config = loadRunnerConfig();
const runner = startRunner({
  url: config.url,
  token: config.token,
  name: config.name,
  ...(config.claudeBin && { claudeBin: config.claudeBin }),
  ...(fakeClaude && { claudeCommand: { command: process.execPath, args: [fakeClaude] } }),
  logger: {
    warn: (message) => console.warn(`[runner] ${message}`),
    error: (message) => console.error(`[runner] ${message}`),
  },
  onStatus: (status) => console.log(`[runner] ${status.kind}`),
});

process.stdin.resume();
process.stdin.on("end", () => {
  void runner.stop().then(() => process.exit(0));
});
