import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connect, login, start, type Running } from './helpers.ts';

describe('playing status', () => {
  let srv: Running;
  before(async () => {
    srv = await start();
  });
  after(() => srv.stop());

  it('shares the game someone has open, cleaned up, and clears it', async () => {
    const a = await connect(srv.wsUrl, (await login(srv.base, 'loucas', 'device-play-001')).body.session);
    const b = await connect(srv.wsUrl, (await login(srv.base, 'nikos', 'device-play-002')).body.session);
    const playing = (m: any) => m.users?.find((u: any) => u.id === 'device-play-001')?.playing;

    a.sock.send({ t: 'state', playing: '  VALORANT\n' });
    assert.equal(playing(await b.sock.next((m) => m.t === 'presence' && playing(m) !== null)), 'VALORANT');

    a.sock.send({ t: 'state', playing: 'x'.repeat(200) });
    assert.equal(playing(await b.sock.next((m) => m.t === 'presence' && playing(m) !== 'VALORANT')).length, 60);

    a.sock.send({ t: 'state', playing: null });
    assert.equal(playing(await b.sock.next((m) => m.t === 'presence' && playing(m) === null)), null);
    a.sock.close();
    b.sock.close();
  });
});
