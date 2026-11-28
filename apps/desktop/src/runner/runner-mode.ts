import { z } from "zod";

/** Who may use the runner this computer offers to a remote server. */
export const RUNNER_MODES = ["personal", "organization", "off"] as const;
export type RunnerMode = (typeof RUNNER_MODES)[number];
export const DEFAULT_RUNNER_MODE: RunnerMode = "personal";

/** The exact enum; anything else (a hand-edited file, a future value) falls back to the default. */
export const runnerModeSchema = z.enum(RUNNER_MODES).catch(DEFAULT_RUNNER_MODE);

/** A mode that holds a token on the server (everything but "off"). */
export type RunnerTokenMode = Exclude<RunnerMode, "off">;
