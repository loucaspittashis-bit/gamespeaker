import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { passwordEpoch, signSession, verifySession, SESSION_TTL_SEC } from '../src/session.ts';
import { RateLimiter } from '../src/ratelimit.ts';
import { ChatStore } from '../src/store.ts';
import { Presence } from '../src/presence.ts';
import { cleanName } from '../src/server.ts';
import { loadConfig } from '../src/config.ts';

const SECRET = 'unit-test-secret-that-is-long-enough-000000';
const user = { sub: 'device-1234', name: 'nikos', color: '#ffb27a' };

describe('sessions', () => {
  const epoch = passwordEpoch('pw', SECRET);

  it('round-trips a signed session', () => {
    const s = verifySession(signSession(user, SECRET, epoch), SECRET, epoch);
    assert.equal(s?.sub, user.sub);
    assert.equal(s?.name, 'nikos');
  });

  it('rejects a tampered payload or signature', () => {
    const token = signSession(user, SECRET, epoch);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...user, name: 'admin', iat: 0, exp: 9e9, e: epoch })).toString('base64url');
    assert.equal(verifySession(`${forged}.${sig}`, SECRET, epoch), null);
    assert.equal(verifySession(`${payload}.AAAA`, SECRET, epoch), null);
    assert.equal(verifySession('garbage', SECRET, epoch), null);
    assert.equal(verifySession(undefined, SECRET, epoch), null);
  });

  it('rejects a session signed with another secret', () => {
    assert.equal(verifySession(signSession(user, SECRET + 'x', epoch), SECRET, epoch), null);
  });

  it('expires', () => {
    const token = signSession(user, SECRET, epoch, 0);
    assert.equal(verifySession(token, SECRET, epoch, (SESSION_TTL_SEC + 1) * 1000), null);
  });

  it('is revoked when the server password changes', () => {
    const token = signSession(user, SECRET, epoch);
    assert.equal(verifySession(token, SECRET, passwordEpoch('new-pw', SECRET)), null);
  });
});

describe('rate limiter', () => {
  it('allows up to the limit per window, then blocks until the window resets', () => {
    const rl = new RateLimiter(3, 1000);
    assert.deepEqual([1, 2, 3, 4].map(() => rl.hit('ip', 0)), [true, true, true, false]);
    assert.equal(rl.hit('other', 0), true);
    assert.equal(rl.retryAfterSec('ip', 0), 1);
    assert.equal(rl.hit('ip', 1000), true);
  });

  it('can be reset', () => {
    const rl = new RateLimiter(1, 1000);
    rl.hit('ip', 0);
    assert.equal(rl.hit('ip', 0), false);
    rl.reset('ip');
    assert.equal(rl.hit('ip', 0), true);
  });
});

describe('chat store', () => {
  it('upgrades an old database and keeps pictures with messages', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gs-store-')), 'chat.db');
    // The 0.1.1 table had no attachments column.
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, user_id TEXT NOT NULL,
      name TEXT NOT NULL, color TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL)`);
    old.prepare('INSERT INTO messages (channel, user_id, name, color, text, ts) VALUES (?, ?, ?, ?, ?, ?)').run('general', 'u', 'n', '#000000', 'old', 1);
    old.close();

    const store = new ChatStore(file);
    const pic = { file: '0123456789abcdef0123456789abcdef.png', width: 640, height: 360 };
    store.add({ channel: 'general', userId: 'u', name: 'n', color: '#000000', text: '', attachments: [pic], ts: 2 });
    const { messages } = store.history('general');
    assert.deepEqual(messages.map((m) => m.attachments), [[], [pic]]);
    assert.equal(store.usesMedia(pic.file), true);
    assert.equal(store.usesMedia('ffffffffffffffffffffffffffffffff.png'), false);
    store.close();
  });

  it('stores and pages history oldest-first', () => {
    const store = new ChatStore(join(mkdtempSync(join(tmpdir(), 'gs-store-')), 'chat.db'));
    for (let i = 1; i <= 5; i++) store.add({ channel: 'general', userId: 'u', name: 'n', color: '#000000', text: `m${i}`, attachments: [], ts: i });
    store.add({ channel: 'clips', userId: 'u', name: 'n', color: '#000000', text: 'other', attachments: [], ts: 9 });

    const latest = store.history('general', undefined, 2);
    assert.deepEqual(latest.messages.map((m) => m.text), ['m4', 'm5']);
    assert.equal(latest.hasMore, true);

    const older = store.history('general', latest.messages[0]!.id, 10);
    assert.deepEqual(older.messages.map((m) => m.text), ['m1', 'm2', 'm3']);
    assert.equal(older.hasMore, false);
    assert.equal(older.messages[0]!.userId, 'u');
    store.close();
  });
});

describe('presence', () => {
  it('keeps a user online until their last connection closes', () => {
    const p = new Presence();
    p.connect({ id: 'a', name: 'A', color: '#111111' });
    p.connect({ id: 'a', name: 'A', color: '#111111' });
    assert.equal(p.disconnect('a'), false);
    assert.equal(p.list().length, 1);
    assert.equal(p.disconnect('a'), true);
    assert.equal(p.list().length, 0);
  });

  it('clears live status when leaving voice', () => {
    const p = new Presence();
    p.connect({ id: 'a', name: 'A', color: '#111111' });
    p.update('a', { channel: 'gaming', live: { title: 'CS2', quality: '1440p60' } });
    p.update('a', { channel: null });
    assert.equal(p.list()[0]!.live, null);
  });
});

describe('input checks', () => {
  it('cleans nicknames', () => {
    assert.equal(cleanName('  nikos  '), 'nikos');
    assert.equal(cleanName('a\u0000b\nc'), 'abc');
    assert.equal(cleanName('two   spaces'), 'two spaces');
    assert.equal(cleanName(''), null);
    assert.equal(cleanName('x'.repeat(33)), null);
    assert.equal(cleanName(42), null);
  });

  it('requires the secrets in config', () => {
    assert.throws(() => loadConfig({}), /SERVER_PASSWORD/);
    assert.throws(
      () => loadConfig({ SERVER_PASSWORD: 'p', SESSION_SECRET: 'short', LIVEKIT_URL: 'u', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' }),
      /at least 32/,
    );
  });
});
