import { DatabaseSync, type StatementSync } from 'node:sqlite';

/** A picture in a chat message: a MediaStore file and its size, so the app can lay it out before it loads. */
export type Attachment = { file: string; width: number; height: number };

export type ChatMessage = {
  id: number;
  channel: string;
  userId: string;
  name: string;
  color: string;
  text: string;
  attachments: Attachment[];
  ts: number;
};

type Row = Omit<ChatMessage, 'attachments'> & { attachments: string | null };
const fromRow = ({ attachments, ...m }: Row): ChatMessage => ({ ...m, attachments: attachments ? JSON.parse(attachments) : [] });

export const MAX_MESSAGES_PER_CHANNEL = 10_000;

// Chat history in a single SQLite file. No database server to run.
export class ChatStore {
  private db: DatabaseSync;
  private insertStmt: StatementSync;
  private latestStmt: StatementSync;
  private beforeStmt: StatementSync;
  private pruneStmt: StatementSync;
  private usesStmt: StatementSync;
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
    // Added in 0.1.2: pictures in chat.
    const cols = this.db.prepare('PRAGMA table_info(messages)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'attachments')) this.db.exec('ALTER TABLE messages ADD COLUMN attachments TEXT');
    this.insertStmt = this.db.prepare(
      'INSERT INTO messages (channel, user_id, name, color, text, attachments, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const select = 'id, channel, user_id AS userId, name, color, text, attachments, ts';
    this.latestStmt = this.db.prepare(`SELECT ${select} FROM messages WHERE channel = ? ORDER BY id DESC LIMIT ?`);
    this.beforeStmt = this.db.prepare(
      `SELECT ${select} FROM messages WHERE channel = ? AND id < ? ORDER BY id DESC LIMIT ?`,
    );
    this.usesStmt = this.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE attachments LIKE '%' || ? || '%'");
    this.pruneStmt = this.db.prepare(
      `DELETE FROM messages WHERE channel = ? AND id <= (
         SELECT id FROM messages WHERE channel = ? ORDER BY id DESC LIMIT 1 OFFSET ?
       )`,
    );
  }

  add(msg: Omit<ChatMessage, 'id'>): ChatMessage {
    const attachments = msg.attachments.length ? JSON.stringify(msg.attachments) : null;
    const result = this.insertStmt.run(msg.channel, msg.userId, msg.name, msg.color, msg.text, attachments, msg.ts);
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
      : this.latestStmt.all(channel, limit + 1)) as unknown as Row[];
    const hasMore = rows.length > limit;
    return { messages: rows.slice(0, limit).reverse().map(fromRow), hasMore };
  }

  /** Whether any message shows this picture (so it isn't deleted with a profile photo). */
  usesMedia(file: string): boolean {
    return Number((this.usesStmt.get(file) as { n: number }).n) > 0;
  }

  close(): void {
    this.db.close();
  }
}
