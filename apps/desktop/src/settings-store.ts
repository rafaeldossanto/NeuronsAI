import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  DEFAULT_TRIGGERS,
  triggersSettingsSchema,
  type TriggersSettings,
} from "./triggers-settings.js";

const FILE_NAME = "desktop-settings.json";

/** What the app remembers between runs. Nothing secret: choices only. */
const storedSettings = z.object({ triggers: triggersSettingsSchema.optional() }).passthrough();

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

  /** Saves the triggers choice, keeping whatever else the file holds. */
  async saveTriggers(triggers: TriggersSettings): Promise<void> {
    let rest: Record<string, unknown> = {};
    try {
      rest = storedSettings.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch {
      // A missing or broken file is rewritten from scratch.
    }
    const body = JSON.stringify(
      { ...rest, triggers: triggersSettingsSchema.parse(triggers) },
      null,
      2,
    );
    await mkdir(this.dataDir, { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${body}\n`, { flag: "wx", mode: 0o600 });
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
