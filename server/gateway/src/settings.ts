import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Channel } from './config.ts';

export type Ban = { id: string; name: string; at: number };

/** What the admin screen changes. Saved next to the chat database and wins over .env. */
export type SavedSettings = {
  serverName?: string;
  serverPassword?: string;
  channels?: Channel[];
  banned?: Ban[];
};

export class SettingsFile {
  private file: string;
  data: SavedSettings;

  constructor(file: string) {
    this.file = file;
    this.data = {};
    if (existsSync(file)) {
      try {
        this.data = JSON.parse(readFileSync(file, 'utf8')) as SavedSettings;
      } catch (err) {
        console.warn(`could not read ${file}, starting from .env settings`, err);
      }
    }
  }

  update(patch: SavedSettings): void {
    this.data = { ...this.data, ...patch };
    // Write then rename, so a crash mid-write never leaves a half-written file.
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
