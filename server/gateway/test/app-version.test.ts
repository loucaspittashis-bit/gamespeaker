import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { appVersion, isOlder } from '../src/version.ts';
import { api, connect, login, start, type Running } from './helpers.ts';

const ua = (app: string) =>
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ${app} Chrome/156.0.8078.48 Electron/45.0.0 Safari/537.36`;
const browser = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

describe('app versions', () => {
  it('reads the desktop app version from its user agent, under either name', () => {
    assert.equal(appVersion(ua('Gamecoms/0.1.9')), '0.1.9');
    assert.equal(appVersion(ua('Gamespeaker/0.1.2')), '0.1.2');
    assert.equal(appVersion(browser), null);
    assert.equal(appVersion(undefined), null);
  });

  it('compares versions by number, not text', () => {
    assert.equal(isOlder('0.1.9', '0.1.10'), true);
    assert.equal(isOlder('0.1.10', '0.1.9'), false);
    assert.equal(isOlder('0.1.10', '0.1.10'), false);
    assert.equal(isOlder('0.2.0', '0.1.10'), false);
    assert.equal(isOlder('0.1.3', '1.0.0'), true);
  });

  it('takes the minimum from MIN_APP_VERSION, or turns it off', () => {
    const env = {
      SERVER_PASSWORD: 'x',
      SESSION_SECRET: 's'.repeat(32),
      LIVEKIT_URL: 'wss://lk.test',
      LIVEKIT_API_KEY: 'k',
      LIVEKIT_API_SECRET: 'v',
    };
    assert.equal(loadConfig(env).minAppVersion, '0.1.10');
    assert.equal(loadConfig({ ...env, MIN_APP_VERSION: '0.2.0' }).minAppVersion, '0.2.0');
    assert.equal(loadConfig({ ...env, MIN_APP_VERSION: 'off' }).minAppVersion, null);
    assert.throws(() => loadConfig({ ...env, MIN_APP_VERSION: 'latest' }), /MIN_APP_VERSION/);
  });
});

describe('voice for old apps', () => {
  let srv: Running;
  let session: string;
  before(async () => {
    srv = await start({ minAppVersion: '0.1.10' });
    session = (await login(srv.base, 'nikos', 'device-version-001')).body.session;
  });
  after(() => srv.stop());

  const join = (userAgent: string) => api(srv.base, '/api/token', { body: { room: 'lobby' }, session, headers: { 'user-agent': userAgent } });

  it('refuses apps older than the minimum, with a message old apps can show', async () => {
    for (const old of ['Gamecoms/0.1.9', 'Gamecoms/0.1.3', 'Gamespeaker/0.1.0']) {
      const res = await join(ua(old));
      assert.equal(res.status, 426, old);
      assert.equal(res.body.error, 'update_required');
      assert.match(res.body.message, /needs an update/);
    }
  });

  it('lets current apps and browsers in', async () => {
    assert.equal((await join(ua('Gamecoms/0.1.10'))).status, 200);
    assert.equal((await join(ua('Gamecoms/0.2.0'))).status, 200);
    assert.equal((await join(browser)).status, 200);
  });

  it('tells apps the minimum when they connect', async () => {
    const { sock, ready } = await connect(srv.wsUrl, session);
    assert.equal(ready.minAppVersion, '0.1.10');
    assert.equal((await api(srv.base, '/api/config')).body.minAppVersion, '0.1.10');
    sock.close();
  });

  it('lets everyone in when there is no minimum', async () => {
    const open = await start({ minAppVersion: null });
    const s = (await login(open.base, 'nikos', 'device-version-002')).body.session;
    const res = await api(open.base, '/api/token', { body: { room: 'lobby' }, session: s, headers: { 'user-agent': ua('Gamecoms/0.1.3') } });
    assert.equal(res.status, 200);
    await open.stop();
  });
});
