import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  DEFAULT_TRIGGERS,
  triggersSettingsSchema,
  type TriggersSettings,
} from "./triggers-settings.js";
import { DEFAULT_RUNNER_MODE, runnerModeSchema, type RunnerMode } from "../runner/runner-mode.js";

const FILE_NAME = "desktop-settings.json";

/** What the app remembers between runs. Nothing secret: choices only. */
const storedSettings = z
  .object({ triggers: triggersSettingsSchema.optional(), runnerMode: z.unknown().optional() })
  .passthrough();

export interface DesktopSettings {
  triggers: TriggersSettings;
}

/**
 * The app's own settings, in a JSON file in its data folder (the profile: beside the database and
 * the Electron files). Reading never fails the app: a missing, unreadable or hand-broken file means
 * the defaults (triggers off), which is the safe choice. Writing is atomic (temporary file, then
 * rename), so a crash never leaves half a file.
 */
export class DesktopSettingsStore {
  constructor(private readonly dataDir: string) {}

  private get file(): string {
    return path.join(this.dataDir, FILE_NAME);
  }

  async load(): Promise<DesktopSettings> {
    try {
      const parsed = storedSettings.parse(JSON.parse(await readFile(this.file, "utf8")));
      return { triggers: parsed.triggers ?? { ...DEFAULT_TRIGGERS } };
    } catch {
      return { triggers: { ...DEFAULT_TRIGGERS } };
    }
  }

  /** The runner mode of this computer: the exact enum, anything unreadable is "personal". */
  async loadRunnerMode(): Promise<RunnerMode> {
    try {
      const parsed = storedSettings.parse(JSON.parse(await readFile(this.file, "utf8")));
      return runnerModeSchema.parse(parsed.runnerMode);
    } catch {
      return DEFAULT_RUNNER_MODE;
    }
  }

  /** Saves the triggers choice, keeping whatever else the file holds. */
  async saveTriggers(triggers: TriggersSettings): Promise<void> {
    await this.patch({ triggers: triggersSettingsSchema.parse(triggers) });
  }

  async saveRunnerMode(mode: RunnerMode): Promise<void> {
    await this.patch({ runnerMode: runnerModeSchema.parse(mode) });
  }

  private async patch(change: Record<string, unknown>): Promise<void> {
    let rest: Record<string, unknown> = {};
    try {
      rest = storedSettings.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch {
      // A missing or broken file is rewritten from scratch.
    }
    const body = JSON.stringify({ ...rest, ...change }, null, 2);
    await mkdir(this.dataDir, { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporary,
        `${body}
`,
        { flag: "wx", mode: 0o600 },
      );
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
