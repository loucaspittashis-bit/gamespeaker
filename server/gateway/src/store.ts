import { DatabaseSync, type StatementSync } from 'node:sqlite';

export type ChatMessage = {
  id: number;
  channel: string;
  userId: string;
  name: string;
  color: string;
  text: string;
  ts: number;
};

export const MAX_MESSAGES_PER_CHANNEL = 10_000;

// Chat history in a single SQLite file. No database server to run.
export class ChatStore {
  private db: DatabaseSync;
  private insertStmt: StatementSync;
  private latestStmt: StatementSync;
  private beforeStmt: StatementSync;
  private pruneStmt: StatementSync;
  private insertsSincePrune = 0;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        text TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_channel_id ON messages (channel, id);
    `);
    this.insertStmt = this.db.prepare(
      'INSERT INTO messages (channel, user_id, name, color, text, ts) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const cols = 'id, channel, user_id AS userId, name, color, text, ts';
    this.latestStmt = this.db.prepare(`SELECT ${cols} FROM messages WHERE channel = ? ORDER BY id DESC LIMIT ?`);
    this.beforeStmt = this.db.prepare(
      `SELECT ${cols} FROM messages WHERE channel = ? AND id < ? ORDER BY id DESC LIMIT ?`,
    );
    this.pruneStmt = this.db.prepare(
      `DELETE FROM messages WHERE channel = ? AND id <= (
         SELECT id FROM messages WHERE channel = ? ORDER BY id DESC LIMIT 1 OFFSET ?
       )`,
    );
  }

  add(msg: Omit<ChatMessage, 'id'>): ChatMessage {
    const result = this.insertStmt.run(msg.channel, msg.userId, msg.name, msg.color, msg.text, msg.ts);
    if (++this.insertsSincePrune >= 200) {
      this.insertsSincePrune = 0;
      this.pruneStmt.run(msg.channel, msg.channel, MAX_MESSAGES_PER_CHANNEL);
    }
    return { id: Number(result.lastInsertRowid), ...msg };
  }

  /** Newest `limit` messages before `before` (or the newest overall), oldest first. */
  history(channel: string, before?: number, limit = 50): { messages: ChatMessage[]; hasMore: boolean } {
    const rows = (before
      ? this.beforeStmt.all(channel, before, limit + 1)
      : this.latestStmt.all(channel, limit + 1)) as unknown as ChatMessage[];
    const hasMore = rows.length > limit;
    return { messages: rows.slice(0, limit).reverse(), hasMore };
  }

  close(): void {
    this.db.close();
  }
}
