import os from "node:os";
import { z } from "zod";

/**
 * The runner's configuration, read from the environment in one place (the only file of this
 * package allowed to touch it, like the server's config module). Never logs or echoes the token.
 */
export interface RunnerConfig {
  /** `ws://` or `wss://` address of the server's runner endpoint. */
  url: string;
  /** Secret issued by the server for this runner. */
  token: string;
  name: string;
  claudeBin?: string;
}

export class RunnerConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuração do runner inválida:\n- ${problems.join("\n- ")}`);
    this.name = "RunnerConfigError";
  }
}

const empty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const envSchema = z.object({
  NEURONS_SERVER_URL: empty(z.string().trim().min(1, "informe o endereço do servidor")),
  NEURONS_RUNNER_TOKEN: empty(z.string().trim().min(1, "informe o token emitido pelo servidor")),
  NEURONS_RUNNER_NAME: empty(z.string().trim().min(1).max(100).optional()),
  NEURONS_CLAUDE_BIN: empty(z.string().trim().min(1).optional()),
  NEURONS_RUNNER_ALLOW_INSECURE: empty(
    z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  ),
});

const isLoopback = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "[::1]" || /^127(\.\d{1,3}){3}$/.test(hostname);

/**
 * Turns the server address (`http(s)://` or `ws(s)://`, with or without the path) into the runner
 * endpoint. The token travels on this connection, so anything but loopback must be `wss://`
 * unless `allowInsecure` says otherwise.
 *
 * @throws RunnerConfigError
 */
export function runnerEndpoint(serverUrl: string, allowInsecure = false): string {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw new RunnerConfigError(["NEURONS_SERVER_URL: não é um endereço válido."]);
  }
  const protocols: Record<string, "ws:" | "wss:"> = {
    "http:": "ws:",
    "ws:": "ws:",
    "https:": "wss:",
    "wss:": "wss:",
  };
  const protocol = protocols[url.protocol];
  if (!protocol) {
    throw new RunnerConfigError(["NEURONS_SERVER_URL: use http(s):// ou ws(s)://."]);
  }
  if (protocol === "ws:" && !isLoopback(url.hostname) && !allowInsecure) {
    throw new RunnerConfigError([
      "NEURONS_SERVER_URL: o token seguiria sem criptografia para outra máquina. Use https:// (wss://) ou, por sua conta e risco, NEURONS_RUNNER_ALLOW_INSECURE=true.",
    ]);
  }
  url.protocol = protocol;
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.pathname = `${url.pathname.replace(/\/+$/, "").replace(/\/runner$/, "")}/runner`;
  return url.toString();
}

/** @throws RunnerConfigError listing every problem found. */
export function loadRunnerConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new RunnerConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const values = parsed.data;
  return {
    url: runnerEndpoint(values.NEURONS_SERVER_URL, values.NEURONS_RUNNER_ALLOW_INSECURE),
    token: values.NEURONS_RUNNER_TOKEN,
    name: values.NEURONS_RUNNER_NAME ?? os.hostname(),
    ...(values.NEURONS_CLAUDE_BIN && { claudeBin: values.NEURONS_CLAUDE_BIN }),
  };
}
