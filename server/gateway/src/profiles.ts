import { DatabaseSync, type StatementSync } from 'node:sqlite';

export type Profile = {
  id: string;
  /** Picture file names from MediaStore, or null. */
  avatar: string | null;
  banner: string | null;
  /** Shown behind the profile card when there is no banner picture. */
  bannerColor: string | null;
  /** An avatar frame the app knows how to draw, e.g. "skulls". */
  frame: string | null;
  frameColor: string | null;
  bio: string;
  updated: number;
};

export type ProfilePatch = Partial<Omit<Profile, 'id' | 'updated'>>;

export const MAX_BIO_CHARS = 190;

const EMPTY: Omit<Profile, 'id'> = {
  avatar: null, banner: null, bannerColor: null, frame: null, frameColor: null, bio: '', updated: 0,
};

// Profile pictures, frames and bios, one row per device.
export class ProfileStore {
  private db: DatabaseSync;
  private getStmt: StatementSync;
  private allStmt: StatementSync;
  private upsertStmt: StatementSync;
  private usesStmt: StatementSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        avatar TEXT,
        banner TEXT,
        banner_color TEXT,
        frame TEXT,
        frame_color TEXT,
        bio TEXT NOT NULL DEFAULT '',
        updated INTEGER NOT NULL
      );
    `);
    const cols = 'id, avatar, banner, banner_color AS bannerColor, frame, frame_color AS frameColor, bio, updated';
    this.getStmt = this.db.prepare(`SELECT ${cols} FROM profiles WHERE id = ?`);
    this.allStmt = this.db.prepare(`SELECT ${cols} FROM profiles ORDER BY updated`);
    this.upsertStmt = this.db.prepare(`
      INSERT INTO profiles (id, avatar, banner, banner_color, frame, frame_color, bio, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        avatar = excluded.avatar, banner = excluded.banner, banner_color = excluded.banner_color,
        frame = excluded.frame, frame_color = excluded.frame_color, bio = excluded.bio, updated = excluded.updated
    `);
    this.usesStmt = this.db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE avatar = ? OR banner = ?');
  }

  get(id: string): Profile {
    const row = this.getStmt.get(id) as Profile | undefined;
    return row ? { ...row } : { id, ...EMPTY };
  }

  all(): Profile[] {
    return (this.allStmt.all() as unknown as Profile[]).map((p) => ({ ...p }));
  }

  update(id: string, patch: ProfilePatch): Profile {
    const p: Profile = { ...this.get(id), ...patch, updated: Date.now() };
    this.upsertStmt.run(p.id, p.avatar, p.banner, p.bannerColor, p.frame, p.frameColor, p.bio, p.updated);
    return p;
  }

  /** Whether any profile still shows this picture. */
  inUse(file: string): boolean {
    return Number((this.usesStmt.get(file, file) as { n: number }).n) > 0;
  }

  close(): void {
    this.db.close();
  }
}
