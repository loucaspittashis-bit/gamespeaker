import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_PASSWORD, api, connect, login, PASSWORD, start, type Running } from './helpers.ts';

async function unlock(srv: Running, session: string) {
  const res = await api(srv.base, '/api/admin/unlock', { body: { password: ADMIN_PASSWORD }, session });
  assert.equal(res.status, 200);
  return res.body.adminToken as string;
}

describe('admin screen', () => {
  let srv: Running;
  let adminSession: string;
  let friendSession: string;
  let admin: string;

  before(async () => {
    srv = await start();
    adminSession = (await login(srv.base, 'loucas', 'device-admin-01')).body.session;
    friendSession = (await login(srv.base, 'nikos', 'device-friend-01')).body.session;
    admin = await unlock(srv, adminSession);
  });
  after(() => srv.stop());

  it('needs a session and the admin password', async () => {
    assert.equal((await api(srv.base, '/api/admin/unlock', { body: { password: ADMIN_PASSWORD } })).status, 401);
    const wrong = await api(srv.base, '/api/admin/unlock', { body: { password: 'nope' }, session: friendSession });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.error, 'wrong_admin_password');
    // The admin password must not be the server password.
    assert.equal((await api(srv.base, '/api/admin/unlock', { body: { password: PASSWORD }, session: friendSession })).status, 403);
  });

  it('ties the admin token to the device that unlocked it', async () => {
    assert.equal((await api(srv.base, '/api/admin/state', { session: adminSession, admin })).status, 200);
    assert.equal((await api(srv.base, '/api/admin/state', { session: friendSession, admin })).status, 403);
    assert.equal((await api(srv.base, '/api/admin/state', { session: adminSession })).status, 403);
    // A session token can't be passed off as an admin token.
    assert.equal((await api(srv.base, '/api/admin/state', { session: adminSession, admin: adminSession })).status, 403);
  });

  it('edits channels, tells everyone live, and keeps them after a restart', async () => {
    const { sock } = await connect(srv.wsUrl, friendSession);
    const channels = [
      { id: 'lobby', name: 'Chill', kind: 'voice' },
      { id: 'cs2', name: 'CS2', kind: 'voice' },
      { id: 'general', name: 'general', kind: 'text', topic: 'hello' },
    ];
    const res = await api(srv.base, '/api/admin/channels', { body: { channels }, session: adminSession, admin });
    assert.equal(res.status, 200);
    const pushed = await sock.next((m) => m.t === 'channels');
    assert.deepEqual(pushed.channels.map((c: any) => c.name), ['Chill', 'CS2', 'general']);
    // New voice channels work immediately, removed ones don't.
    assert.equal((await api(srv.base, '/api/token', { body: { room: 'cs2' }, session: friendSession })).status, 200);
    assert.equal((await api(srv.base, '/api/token', { body: { room: 'gaming' }, session: friendSession })).status, 400);
    sock.close();

    const again = await start({ dataDir: srv.config.dataDir });
    const cfg = await api(again.base, '/api/config');
    assert.deepEqual(cfg.body.channels.map((c: any) => c.id), ['lobby', 'cs2', 'general']);
    await again.stop();
  });

  it('rejects broken channel lists', async () => {
    const bad = [
      [],
      [{ id: 'a', name: 'A', kind: 'voice' }], // no text channel
      [{ id: 'a', name: 'A', kind: 'voice' }, { id: 'a', name: 'B', kind: 'text' }], // duplicate id
      [{ id: 'Bad Id', name: 'A', kind: 'voice' }, { id: 't', name: 'T', kind: 'text' }],
      [{ id: 'a', name: '', kind: 'voice' }, { id: 't', name: 'T', kind: 'text' }],
    ];
    for (const channels of bad) {
      const res = await api(srv.base, '/api/admin/channels', { body: { channels }, session: adminSession, admin });
      assert.equal(res.status, 400, JSON.stringify(channels));
      assert.equal(res.body.error, 'invalid_channels');
    }
  });

  it('renames the server live', async () => {
    const { sock } = await connect(srv.wsUrl, friendSession);
    const res = await api(srv.base, '/api/admin/server', { body: { serverName: 'The Crew' }, session: adminSession, admin });
    assert.equal(res.status, 200);
    assert.equal((await sock.next((m) => m.t === 'server')).serverName, 'The Crew');
    assert.equal((await api(srv.base, '/api/config')).body.name, 'The Crew');
    sock.close();
  });

  it('kicks a friend out of chat and voice', async () => {
    const { sock } = await connect(srv.wsUrl, friendSession);
    const res = await api(srv.base, '/api/admin/kick', { body: { userId: 'device-friend-01' }, session: adminSession, admin });
    assert.equal(res.status, 200);
    assert.equal((await sock.closed).code, 4004);
    // A kick is not a ban: they can come straight back.
    assert.equal((await login(srv.base, 'nikos', 'device-friend-01')).status, 200);
  });

  it('cannot kick or ban yourself', async () => {
    const res = await api(srv.base, '/api/admin/ban', { body: { userId: 'device-admin-01' }, session: adminSession, admin });
    assert.equal(res.status, 400);
  });

  it('bans a device until it is unbanned', async () => {
    const { sock } = await connect(srv.wsUrl, friendSession);
    const res = await api(srv.base, '/api/admin/ban', { body: { userId: 'device-friend-01' }, session: adminSession, admin });
    assert.equal(res.status, 200);
    assert.ok(res.body.banned.some((b: any) => b.id === 'device-friend-01' && b.name === 'nikos'));
    assert.equal((await sock.closed).code, 4005);
    assert.equal((await login(srv.base, 'nikos', 'device-friend-01')).status, 403);
    assert.equal((await api(srv.base, '/api/token', { body: { room: 'lobby' }, session: friendSession })).status, 401);

    const un = await api(srv.base, '/api/admin/unban', { body: { userId: 'device-friend-01' }, session: adminSession, admin });
    assert.equal(un.body.banned.length, 0);
    assert.equal((await login(srv.base, 'nikos', 'device-friend-01')).status, 200);
  });

  it('changing the server password signs everyone out', async () => {
    const { sock } = await connect(srv.wsUrl, friendSession);
    const res = await api(srv.base, '/api/admin/server', { body: { serverPassword: 'new crew password' }, session: adminSession, admin });
    assert.equal(res.status, 200);
    assert.equal(res.body.signedOut, true);
    assert.equal((await sock.closed).code, 4003);
    assert.equal((await login(srv.base, 'nikos', 'device-friend-01')).status, 401);
    assert.equal((await login(srv.base, 'nikos', 'device-friend-01', 'new crew password')).status, 200);

    // It sticks after a restart, overriding .env.
    const again = await start({ dataDir: srv.config.dataDir });
    assert.equal((await login(again.base, 'nikos', 'device-friend-01', 'new crew password')).status, 200);
    assert.equal((await login(again.base, 'nikos', 'device-friend-01')).status, 401);
    await again.stop();
  });
});

describe('admin turned off', () => {
  it('hides the admin API when no ADMIN_PASSWORD is set', async () => {
    const srv = await start({ adminPassword: null });
    const { session } = (await login(srv.base, 'kat', 'device-kat-0001')).body;
    assert.equal((await api(srv.base, '/api/config')).body.admin, false);
    assert.equal((await api(srv.base, '/api/admin/unlock', { body: { password: 'x' }, session })).status, 404);
    await srv.stop();
  });
});
