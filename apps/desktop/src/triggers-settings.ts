import { z } from "zod";

// Pure rules of the external-triggers setting (webhooks), free of Electron so they are tested
// without it. The choice lives in the app's own profile (`settings-store.ts`) and is handed to the
// embedded server when it starts (`server.ts`), so a change only takes effect after a restart.

/** The port the screen proposes. The README of the server uses it in its examples. */
export const DEFAULT_TRIGGERS_PORT = 3101;
/** Below 1024 a port needs privileges on some systems; the embedded server never asks for them. */
export const MIN_TRIGGERS_PORT = 1024;
export const MAX_TRIGGERS_PORT = 65_535;

export const triggersSettingsSchema = z
  .object({
    enabled: z.boolean(),
    port: z.number().int().min(MIN_TRIGGERS_PORT).max(MAX_TRIGGERS_PORT),
  })
  .strict();
export type TriggersSettings = z.infer<typeof triggersSettingsSchema>;

/** Off by default: nothing listens until the person turns it on. */
export const DEFAULT_TRIGGERS: Readonly<TriggersSettings> = {
  enabled: false,
  port: DEFAULT_TRIGGERS_PORT,
};

/** A refusal with a message that is meant for the person, in pt-BR. */
export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

/** Reads what the renderer sent. Anything else than exactly `{ enabled, port }` is refused. */
export function parseTriggersSettings(value: unknown): TriggersSettings {
  const parsed = triggersSettingsSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const portProblem = parsed.error.issues.some((issue) => issue.path[0] === "port");
  throw new SettingsError(
    portProblem
      ? `Use uma porta entre ${String(MIN_TRIGGERS_PORT)} e ${String(MAX_TRIGGERS_PORT)}.`
      : "Configuração dos gatilhos inválida.",
  );
}

/** What the running server was started with, as far as the triggers go. */
export interface AppliedTriggers {
  /** The webhook port is open. */
  listening: boolean;
  port: number | null;
  host: string | null;
  /** Where the setting came from: the app's own choice or `NEURONS_HOOKS_PORT`, which wins. */
  source: "app" | "environment";
  /** Why the app's choice could not be honoured (e.g. the port was taken), if it could not. */
  problem?: string;
}

/** What the screen shows. */
export interface TriggersView {
  /** The saved choice. */
  enabled: boolean;
  port: number;
  /** `NEURONS_HOOKS_PORT` is set: it decides, and the screen cannot change it. */
  environment: boolean;
  /** Where the webhook port answers now (`http://127.0.0.1:3101`), or null while it is off. */
  address: string | null;
  /** The saved choice is not what is running: the embedded server must restart. */
  restartRequired: boolean;
  /** Why the choice is not running although it was asked for, if there is a reason. */
  problem: string | null;
}

export function triggersView(saved: TriggersSettings, applied: AppliedTriggers): TriggersView {
  const environment = applied.source === "environment";
  const address =
    applied.listening && applied.host && applied.port !== null
      ? `http://${applied.host}:${String(applied.port)}`
      : null;
  const differs =
    saved.enabled !== applied.listening || (saved.enabled && saved.port !== applied.port);
  return {
    enabled: saved.enabled,
    port: saved.port,
    environment,
    address,
    restartRequired: !environment && differs,
    problem: applied.problem ?? null,
  };
}

/** The setting of a server that listens (or not) on the port `config.hooks` says. */
export function appliedFrom(
  hooks: { port: number; host: string } | undefined,
  source: AppliedTriggers["source"],
  problem?: string,
): AppliedTriggers {
  return {
    listening: hooks !== undefined,
    port: hooks?.port ?? null,
    host: hooks?.host ?? null,
    source,
    ...(problem && { problem }),
  };
}

/** The server's message when the webhook port could not be opened (see `HooksServer`). */
const HOOKS_PORT_FAILURE = /porta dos gatilhos/i;

export interface StartedWithTriggers<Server> {
  server: Server;
  /** Set when the server only came up because the triggers were turned off for this run. */
  problem?: string;
}

/**
 * Starts the server and, when it fails only because the webhook port could not be opened (taken by
 * another program), starts it again with the triggers off, so the app still opens and the person
 * can fix the port on the settings screen. Any other failure is rethrown as it is.
 */
export async function startWithTriggersFallback<
  Config extends { hooks?: { port: number } },
  Server,
>(
  config: Config,
  fromApp: boolean,
  start: (config: Config) => Promise<Server>,
): Promise<StartedWithTriggers<Server>> {
  try {
    return { server: await start(config) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!fromApp || config.hooks === undefined || !HOOKS_PORT_FAILURE.test(message)) throw error;
    const { hooks, ...withoutHooks } = config;
    const server = await start(withoutHooks as unknown as Config);
    return {
      server,
      problem: `Não foi possível abrir a porta ${String(hooks.port)} (talvez outro programa esteja usando). Os gatilhos ficaram desligados nesta abertura; escolha outra porta e reinicie.`,
    };
  }
}
