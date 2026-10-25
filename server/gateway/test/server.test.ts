import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TokenVerifier } from 'livekit-server-sdk';
import { api, connect, login, openSocket, PASSWORD, start, type Running } from './helpers.ts';

describe('HTTP API', () => {
  let srv: Running;
  before(async () => {
    srv = await start();
  });
  after(() => srv.stop());

  it('reports health and public config without secrets', async () => {
    assert.equal((await api(srv.base, '/api/health')).body.ok, true);
    const { body } = await api(srv.base, '/api/config');
    assert.equal(body.name, 'Test Server');
    assert.equal(body.livekitUrl, 'wss://example.test');
    assert.ok(body.channels.some((c: any) => c.id === 'gaming' && c.kind === 'voice'));
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes(PASSWORD) && !raw.includes(srv.config.livekitApiSecret) && !raw.includes(srv.config.sessionSecret));
  });

  it('answers CORS preflight', async () => {
    const res = await api(srv.base, '/api/login', { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  it('rejects a wrong password and bad input', async () => {
    assert.equal((await login(srv.base, 'nikos', 'device-aaaa1111', 'nope')).status, 401);
    assert.equal((await login(srv.base, '   ', 'device-aaaa1111')).status, 400);
    assert.equal((await login(srv.base, 'nikos', 'bad id!')).status, 400);
    assert.equal((await api(srv.base, '/api/login', { body: 'not an object' })).status, 400);
  });

  it('logs in and returns a session plus an avatar color', async () => {
    const res = await login(srv.base, '  nikos ', 'device-aaaa1111');
    assert.equal(res.status, 200);
    assert.equal(res.body.user.name, 'nikos');
    assert.equal(res.body.user.id, 'device-aaaa1111');
    assert.match(res.body.user.color, /^#[0-9a-f]{6}$/);
    assert.equal(typeof res.body.session, 'string');
  });

  it('rate-limits password guessing per client IP', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < 10; i++) {
      const r = await api(srv.base, '/api/login', { body: { name: 'x', deviceId: 'device-bbbb2222', password: 'guess' + i }, headers });
      assert.equal(r.status, 401);
    }
    const blocked = await api(srv.base, '/api/login', { body: { name: 'x', deviceId: 'device-bbbb2222', password: PASSWORD }, headers });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    // Other addresses are unaffected.
    assert.equal((await login(srv.base, 'kat', 'device-cccc3333')).status, 200);
  });

  it('mints LiveKit tokens only for voice channels and valid sessions', async () => {
    const { session } = (await login(srv.base, 'elena', 'device-dddd4444')).body;
    assert.equal((await api(srv.base, '/api/token', { body: { room: 'gaming' } })).status, 401);
    assert.equal((await api(srv.base, '/api/token', { body: { room: 'gaming' }, session: session + 'x' })).status, 401);
    assert.equal((await api(srv.base, '/api/token', { body: { room: 'general' }, session })).status, 400);

    const res = await api(srv.base, '/api/token', { body: { room: 'gaming' }, session });
    assert.equal(res.status, 200);
    assert.equal(res.body.url, 'wss://example.test');
    const claims = await new TokenVerifier(srv.config.livekitApiKey, srv.config.livekitApiSecret).verify(res.body.token);
    assert.equal(claims.sub, 'device-dddd4444');
    assert.equal(claims.name, 'elena');
    assert.equal(claims.video?.room, 'gaming');
    assert.equal(claims.video?.roomJoin, true);
    assert.equal(claims.video?.canPublish, true);
    assert.equal(JSON.parse(claims.metadata ?? '{}').color.startsWith('#'), true);
  });

  it('renames via /api/me and the new session works', async () => {
    const { session } = (await login(srv.base, 'marios', 'device-eeee5555')).body;
    const res = await api(srv.base, '/api/me', { body: { name: 'marios2', color: '#FF9EC4' }, session });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.name, 'marios2');
    assert.equal(res.body.user.color, '#ff9ec4');
    assert.equal((await api(srv.base, '/api/token', { body: { room: 'lobby' }, session: res.body.session })).status, 200);
  });
});

describe('sessions across restarts', () => {
  it('survive a restart but not a password change', async () => {
    const a = await start();
    const { session } = (await login(a.base, 'kat', 'device-ffff6666')).body;
    await a.stop();

    const same = await start({ dataDir: a.config.dataDir });
    assert.equal((await api(same.base, '/api/token', { body: { room: 'lobby' }, session })).status, 200);
    await same.stop();

    const rotated = await start({ dataDir: a.config.dataDir, serverPassword: 'a brand new password' });
    assert.equal((await api(rotated.base, '/api/token', { body: { room: 'lobby' }, session })).status, 401);
    await rotated.stop();
  });
});

describe('WebSocket presence and chat', () => {
  let srv: Running;
  let sA: string;
  let sB: string;
  before(async () => {
    srv = await start();
    sA = (await login(srv.base, 'nikos', 'device-user-a')).body.session;
    sB = (await login(srv.base, 'elena', 'device-user-b')).body.session;
  });
  after(() => srv.stop());

  it('closes connections that do not authenticate first', async () => {
    const sock = await openSocket(srv.wsUrl);
    sock.send({ t: 'chat', channel: 'general', text: 'hi' });
    assert.equal((await sock.closed).code, 4001);
  });

  it('rejects an invalid session', async () => {
    const sock = await openSocket(srv.wsUrl);
    sock.send({ t: 'auth', session: 'nope.nope' });
    assert.equal((await sock.next((m) => m.t === 'error')).code, 'invalid_session');
    assert.equal((await sock.closed).code, 4003);
  });

  it('shares presence, voice state, chat, typing and history', async () => {
    const a = await connect(srv.wsUrl, sA);
    assert.equal(a.ready.you.name, 'nikos');
    assert.ok(a.ready.channels.length > 0);

    const b = await connect(srv.wsUrl, sB);
    assert.deepEqual(b.ready.users.map((u: any) => u.name).sort(), ['elena', 'nikos']);
    await a.sock.next((m) => m.t === 'presence' && m.users.length === 2);

    // Voice state: join, mute, go live. Unknown channels are ignored.
    a.sock.send({ t: 'state', channel: 'gaming', muted: true, live: { title: 'Counter-Strike 2', quality: '1440p60' } });
    const p = await b.sock.next((m) => m.t === 'presence' && m.users.some((u: any) => u.channel === 'gaming'));
    const nikos = p.users.find((u: any) => u.name === 'nikos');
    assert.equal(nikos.muted, true);
    assert.deepEqual(nikos.live, { title: 'Counter-Strike 2', quality: '1440p60' });
    a.sock.send({ t: 'state', channel: 'not-a-channel' });
    await b.sock.none((m) => m.t === 'presence' && m.users.some((u: any) => u.channel === 'not-a-channel'));

    // Chat is broadcast to everyone and saved.
    a.sock.send({ t: 'chat', channel: 'general', text: '  hello there  ', nonce: 'n1' });
    const mine = await a.sock.next((m) => m.t === 'chat');
    const theirs = await b.sock.next((m) => m.t === 'chat');
    assert.equal(mine.nonce, 'n1');
    assert.equal(theirs.msg.text, 'hello there');
    assert.equal(theirs.msg.name, 'nikos');
    assert.equal(theirs.msg.channel, 'general');

    b.sock.send({ t: 'history', channel: 'general' });
    const hist = await b.sock.next((m) => m.t === 'history');
    assert.deepEqual(hist.messages.map((m: any) => m.text), ['hello there']);
    assert.equal(hist.hasMore, false);

    // Bad chat input is refused.
    a.sock.send({ t: 'chat', channel: 'nope', text: 'x', nonce: 'n2' });
    assert.equal((await a.sock.next((m) => m.t === 'error' && m.nonce === 'n2')).code, 'unknown_channel');
    a.sock.send({ t: 'chat', channel: 'general', text: 'x'.repeat(2001), nonce: 'n3' });
    assert.equal((await a.sock.next((m) => m.t === 'error' && m.nonce === 'n3')).code, 'invalid_text');

    // Typing goes to others only.
    a.sock.send({ t: 'typing', channel: 'gaming' });
    assert.equal((await b.sock.next((m) => m.t === 'typing')).name, 'nikos');
    await a.sock.none((m) => m.t === 'typing');

    // A second connection keeps nikos online when the first closes.
    const a2 = await connect(srv.wsUrl, sA);
    a.sock.close();
    await b.sock.none((m) => m.t === 'presence' && m.users.length === 1, 400);
    a2.sock.close();
    await b.sock.next((m) => m.t === 'presence' && m.users.length === 1 && m.users[0].name === 'elena');
    b.sock.close();
  });

  it('posts a message resent after a lost reply only once', async () => {
    const a = await connect(srv.wsUrl, sB);
    const b = await connect(srv.wsUrl, sA);
    const seen: number[] = [];
    const watch = b.sock.next((m) => m.t === 'chat' && m.msg.text === 'just once' && (seen.push(m.msg.id), false), 1500).catch(() => null);
    a.sock.send({ t: 'chat', channel: 'clips', text: 'just once', nonce: 'dup-1' });
    const first = await a.sock.next((m) => m.t === 'chat' && m.nonce === 'dup-1');
    // The same message again, as after a reconnect: confirmed with the original, not posted again.
    a.sock.send({ t: 'chat', channel: 'clips', text: 'just once', nonce: 'dup-1' });
    const again = await a.sock.next((m) => m.t === 'chat' && m.nonce === 'dup-1');
    assert.equal(again.msg.id, first.msg.id);
    await watch;
    assert.deepEqual(seen, [first.msg.id]);
    a.sock.send({ t: 'history', channel: 'clips', limit: 50 });
    const history = await a.sock.next((m) => m.t === 'history' && m.channel === 'clips');
    assert.equal(history.messages.filter((m: any) => m.text === 'just once').length, 1);
    a.sock.close();
    b.sock.close();
  });

  it('slows down chat floods', async () => {
    const { sock } = await connect(srv.wsUrl, sA);
    for (let i = 0; i < 9; i++) sock.send({ t: 'chat', channel: 'memes', text: `spam ${i}`, nonce: `s${i}` });
    assert.equal((await sock.next((m) => m.t === 'error' && m.nonce === 's8')).code, 'slow_down');
    sock.close();
  });

  it('keeps chat history across a restart', async () => {
    const dataDir = srv.config.dataDir;
    const again = await start({ dataDir });
    const { sock } = await connect(again.wsUrl, sB);
    sock.send({ t: 'history', channel: 'general' });
    assert.deepEqual((await sock.next((m) => m.t === 'history')).messages.map((m: any) => m.text), ['hello there']);
    sock.close();
    await again.stop();
  });
});
