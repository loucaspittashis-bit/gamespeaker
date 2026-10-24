import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { api, connect, login, start, type Running, type TestSocket } from './helpers.ts';

function png(width: number, height: number, seed = 0): Buffer {
  const ihdr = Buffer.alloc(8);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
    Buffer.from('IHDR'), ihdr, Buffer.from([8, 6, 0, 0, 0, seed, 0, 0, 0]),
  ]);
}

async function post(base: string, path: string, body: Buffer, session: string) {
  const res = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${session}` }, body });
  return { status: res.status, body: await res.json() as any };
}

describe('pictures in chat', () => {
  let srv: Running;
  let session: string;
  let sock: TestSocket;

  before(async () => {
    srv = await start();
    session = (await login(srv.base, 'loucas', 'device-pics-001')).body.session;
    sock = (await connect(srv.wsUrl, session)).sock;
  });
  after(async () => {
    sock.close();
    await srv.stop();
  });

  it('uploads a picture and sends it with or without text', async () => {
    const up = await post(srv.base, '/api/chat/upload', png(1920, 1080), session);
    assert.equal(up.status, 200);
    assert.match(up.body.file, /^[a-f0-9]{32}\.png$/);
    assert.equal(up.body.width, 1920);

    sock.send({ t: 'chat', channel: 'general', text: '', attachments: [up.body], nonce: 'p1' });
    const got = await sock.next((m) => m.t === 'chat' && m.nonce === 'p1');
    assert.deepEqual(got.msg.attachments, [up.body]);
    assert.equal(got.msg.text, '');

    sock.send({ t: 'history', channel: 'general' });
    const hist = await sock.next((m) => m.t === 'history');
    assert.deepEqual(hist.messages.at(-1).attachments, [up.body]);
  });

  it('refuses pictures that were never uploaded, too many, or odd sizes', async () => {
    const up = (await post(srv.base, '/api/chat/upload', png(64, 64, 1), session)).body;
    const bad = [
      [{ file: 'ffffffffffffffffffffffffffffffff.png', width: 10, height: 10 }],
      [{ file: '../chat.db', width: 10, height: 10 }],
      Array(5).fill(up),
      [{ ...up, width: 0 }],
      'not a list',
    ];
    for (const [i, attachments] of bad.entries()) {
      sock.send({ t: 'chat', channel: 'general', text: 'x', attachments, nonce: `bad${i}` });
      assert.equal((await sock.next((m) => m.nonce === `bad${i}`)).code, 'invalid_attachments');
    }
    sock.send({ t: 'chat', channel: 'general', text: '  ', attachments: [], nonce: 'empty' });
    assert.equal((await sock.next((m) => m.nonce === 'empty')).code, 'invalid_text');
  });

  it('keeps a chat picture when the same picture is removed as a profile photo', async () => {
    const pic = png(256, 256, 7);
    const up = (await post(srv.base, '/api/chat/upload', pic, session)).body;
    sock.send({ t: 'chat', channel: 'general', text: 'look', attachments: [up], nonce: 'keep' });
    await sock.next((m) => m.nonce === 'keep');
    const avatar = (await post(srv.base, '/api/me/avatar', pic, session)).body.avatar;
    assert.equal(avatar, up.file);
    await api(srv.base, '/api/me/profile', { body: { avatar: null }, session });
    assert.equal((await fetch(`${srv.base}/api/media/${up.file}`)).status, 200);
  });
});
