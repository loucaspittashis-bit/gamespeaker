import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connect, login, start, type Running } from './helpers.ts';

describe('status, custom status and watching', () => {
  let srv: Running;
  before(async () => {
    srv = await start();
  });
  after(() => srv.stop());

  it('shares status, a cleaned custom status, and whose stream someone watches', async () => {
    const a = await connect(srv.wsUrl, (await login(srv.base, 'loucas', 'device-stat-001')).body.session);
    const b = await connect(srv.wsUrl, (await login(srv.base, 'nikos', 'device-stat-002')).body.session);
    const me = (m: any) => m.users?.find((u: any) => u.id === 'device-stat-001');
    assert.equal(me(a.ready).status, 'online');
    assert.equal(me(a.ready).custom, null);

    a.sock.send({
      t: 'state', channel: 'lobby', status: 'dnd', custom: { emoji: '💀', text: '  ranked\ngrind ' },
      watching: 'device-stat-002', watching2: 'device-stat-003',
    });
    const u = me(await b.sock.next((m) => m.t === 'presence' && me(m)?.status === 'dnd'));
    assert.deepEqual(u.custom, { emoji: '💀', text: 'ranked grind' });
    assert.equal(u.watching, 'device-stat-002');
    assert.equal(u.watching2, 'device-stat-003', 'a second stream, side by side');

    // Nonsense is ignored; an empty custom status clears it.
    a.sock.send({ t: 'state', status: 'invisible', custom: { emoji: '', text: '   ' }, watching: '<script>' });
    const v = me(await b.sock.next((m) => m.t === 'presence' && me(m)?.custom === null));
    assert.equal(v.status, 'dnd');
    assert.equal(v.watching, 'device-stat-002');

    // Leaving voice stops watching.
    a.sock.send({ t: 'state', channel: null, status: 'idle' });
    const w = me(await b.sock.next((m) => m.t === 'presence' && me(m)?.status === 'idle'));
    assert.equal(w.watching, null);
    assert.equal(w.watching2, null);
    a.sock.close();
    b.sock.close();
  });
});
