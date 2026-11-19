import { z } from "zod";

/**
 * The desktop app's own configuration, read from the environment in one place (the only file of
 * this package allowed to touch it, like the server's config module). Everything else (data
 * folder, Claude Code binary, limits) is the server's `NEURONS_*` configuration, read by the server.
 */
export interface DesktopConfig {
  /**
   * Replaces the Claude Code CLI with another program (a fake one, for demos and tests): program
   * and leading arguments. Absent: the real CLI is found as usual.
   */
  claudeCommand?: { command: string; args: string[] };
  /** The same for the Codex CLI (`NEURONS_DESKTOP_CODEX_COMMAND` and `_ARGS`). */
  codexCommand?: { command: string; args: string[] };
  /** `NEURONS_DESKTOP_UPDATES=off`: never look for a new version (tests, offline machines). */
  updatesOff?: true;
  /** Set when the app runs from an AppImage (the only Linux package that updates itself). */
  appImage?: true;
}

export class DesktopConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuração do app desktop inválida:\n- ${problems.join("\n- ")}`);
    this.name = "DesktopConfigError";
  }
}

const empty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

/** A JSON list of texts, as the `*_ARGS` variables carry the arguments of a replacement CLI. */
const argList = () =>
  empty(
    z
      .string()
      .transform((text, ctx) => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          ctx.addIssue({ code: "custom", message: "deve ser uma lista JSON de textos" });
          return z.NEVER;
        }
      })
      .pipe(z.array(z.string()))
      .optional(),
  );

const envSchema = z.object({
  NEURONS_DESKTOP_UPDATES: empty(z.enum(["on", "off"]).optional()),
  // Set by the AppImage runtime to the path of the running image.
  APPIMAGE: empty(z.string().optional()),
  NEURONS_DESKTOP_CLAUDE_COMMAND: empty(z.string().trim().min(1).optional()),
  NEURONS_DESKTOP_CLAUDE_ARGS: argList(),
  NEURONS_DESKTOP_CODEX_COMMAND: empty(z.string().trim().min(1).optional()),
  NEURONS_DESKTOP_CODEX_ARGS: argList(),
});

export function loadDesktopConfig(env: NodeJS.ProcessEnv = process.env): DesktopConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new DesktopConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const { NEURONS_DESKTOP_CLAUDE_COMMAND: command, NEURONS_DESKTOP_CLAUDE_ARGS: args } =
    parsed.data;
  if (!command && args) {
    throw new DesktopConfigError([
      "NEURONS_DESKTOP_CLAUDE_ARGS só vale junto com NEURONS_DESKTOP_CLAUDE_COMMAND",
    ]);
  }
  const { NEURONS_DESKTOP_CODEX_COMMAND: codex, NEURONS_DESKTOP_CODEX_ARGS: codexArgs } =
    parsed.data;
  if (!codex && codexArgs) {
    throw new DesktopConfigError([
      "NEURONS_DESKTOP_CODEX_ARGS só vale junto com NEURONS_DESKTOP_CODEX_COMMAND",
    ]);
  }
  return {
    ...(command && { claudeCommand: { command, args: args ?? [] } }),
    ...(codex && { codexCommand: { command: codex, args: codexArgs ?? [] } }),
    ...(parsed.data.NEURONS_DESKTOP_UPDATES === "off" && { updatesOff: true as const }),
    ...(parsed.data.APPIMAGE && { appImage: true as const }),
  };
}
