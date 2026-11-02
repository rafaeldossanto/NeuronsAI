export type HostEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * The environment of the process hosting the runtimes. This is the only place of the package that
 * reads `process.env`; everything else receives the snapshot as a parameter and filters it (see
 * `buildChildEnv`), so the host's secrets never reach an agent's CLI by accident.
 */
export const readHostEnvironment = (): HostEnvironment => process.env;
