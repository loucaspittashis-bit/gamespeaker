import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sniffImage } from '../src/media.ts';
import { api, connect, login, start, type Running } from './helpers.ts';

// Just enough bytes for each format's header; the server never decodes pictures.
function png(width: number, height: number, padding = 0): Buffer {
  const ihdr = Buffer.alloc(8);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
    Buffer.from('IHDR'),
    ihdr,
    Buffer.from([8, 6, 0, 0, 0, 0, 0, 0, 0]),
    Buffer.alloc(padding),
  ]);
}

function gif(width: number, height: number): Buffer {
  const b = Buffer.alloc(32);
  b.write('GIF89a', 0, 'ascii');
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
}

function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(8)]);
}

function webp(width: number, height: number): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(22, 4);
  b.write('WEBPVP8X', 8, 'ascii');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

async function upload(base: string, kind: 'avatar' | 'banner', body: Buffer, session?: string) {
  const res = await fetch(`${base}/api/me/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', ...(session ? { authorization: `Bearer ${session}` } : {}) },
    body,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('sniffImage', () => {
  it('reads the format and size from the header', () => {
    assert.deepEqual(sniffImage(png(256, 128)), { ext: 'png', width: 256, height: 128 });
    assert.deepEqual(sniffImage(gif(320, 240)), { ext: 'gif', width: 320, height: 240 });
    assert.deepEqual(sniffImage(jpeg(1920, 1080)), { ext: 'jpg', width: 1920, height: 1080 });
    assert.deepEqual(sniffImage(webp(960, 384)), { ext: 'webp', width: 960, height: 384 });
  });

  it('refuses anything else, including SVG', () => {
    assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')), null);
    assert.equal(sniffImage(Buffer.from('just some text that is long enough')), null);
    assert.equal(sniffImage(Buffer.alloc(4)), null);
  });
});

describe('profiles', () => {
  let srv: Running;
  let mine: string;
  let theirs: string;

  before(async () => {
    srv = await start();
    mine = (await login(srv.base, 'loucas', 'device-profile-1')).body.session;
    theirs = (await login(srv.base, 'nikos', 'device-profile-2')).body.session;
  });
  after(() => srv.stop());

  it('needs a session to upload', async () => {
    assert.equal((await upload(srv.base, 'avatar', png(64, 64))).status, 401);
  });

  it('stores a photo, serves it, and tells everyone', async () => {
    const { sock, ready } = await connect(srv.wsUrl, theirs);
    assert.deepEqual(ready.profiles, []);
    const pic = png(256, 256, 100);
    const res = await upload(srv.base, 'avatar', pic, mine);
    assert.equal(res.status, 200);
    assert.match(res.body.avatar, /^[a-f0-9]{32}\.png$/);

    const pushed = await sock.next((m) => m.t === 'profile');
    assert.equal(pushed.profile.id, 'device-profile-1');
    assert.equal(pushed.profile.avatar, res.body.avatar);

    const got = await fetch(`${srv.base}/api/media/${res.body.avatar}`);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('content-type'), 'image/png');
    assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
    assert.match(got.headers.get('cache-control') ?? '', /immutable/);
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), pic);
    sock.close();
  });

  it('accepts GIF banners', async () => {
    const res = await upload(srv.base, 'banner', gif(600, 240), mine);
    assert.equal(res.status, 200);
    assert.match(res.body.banner, /\.gif$/);
  });

  it('refuses files that are not pictures, huge pictures and big files', async () => {
    const svg = await upload(srv.base, 'avatar', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), mine);
    assert.equal(svg.status, 415);
    assert.equal(svg.body.error, 'unsupported_image');
    assert.equal((await upload(srv.base, 'avatar', png(10_000, 64), mine)).status, 400);
    assert.equal((await upload(srv.base, 'avatar', png(64, 64, 6 * 1024 * 1024), mine)).status, 413);
  });

  it('saves the frame, colors and bio', async () => {
    const res = await api(srv.base, '/api/me/profile', {
      body: { frame: 'skulls', frameColor: '#EFE6D2', bannerColor: '#ff2bd6', bio: 'ranked grind\n\n\n\nevery night' },
      session: mine,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.frame, 'skulls');
    assert.equal(res.body.frameColor, '#efe6d2');
    assert.equal(res.body.bio, 'ranked grind\n\nevery night');
    assert.match(res.body.avatar, /\.png$/, 'editing other fields keeps the photo');
  });

  it('rejects bad frames, colors and long bios', async () => {
    for (const body of [{ frame: '<img>' }, { frameColor: 'red' }, { bio: 'x'.repeat(191) }, { bio: 42 }]) {
      assert.equal((await api(srv.base, '/api/me/profile', { body, session: mine })).status, 400, JSON.stringify(body));
    }
  });

  it('deletes a removed photo nobody else uses', async () => {
    const before = (await api(srv.base, '/api/me/profile', { body: {}, session: mine })).body;
    // Someone else uploads the same picture as the banner: the file is shared.
    const shared = await upload(srv.base, 'banner', gif(600, 240), theirs);
    assert.equal(shared.body.banner, before.banner);

    await api(srv.base, '/api/me/profile', { body: { avatar: null, banner: null }, session: mine });
    assert.equal((await fetch(`${srv.base}/api/media/${before.avatar}`)).status, 404);
    assert.equal((await fetch(`${srv.base}/api/media/${before.banner}`)).status, 200, 'still used by the other profile');
  });

  it('only serves stored picture names', async () => {
    for (const name of ['..%2Fchat.db', 'chat.db', 'abc.svg', '0123456789abcdef0123456789abcdef.svg']) {
      assert.equal((await fetch(`${srv.base}/api/media/${name}`)).status, 404, name);
    }
  });

  it('keeps profiles after a restart', async () => {
    const again = await start({ dataDir: srv.config.dataDir });
    const session = (await login(again.base, 'loucas', 'device-profile-1')).body.session;
    const { sock, ready } = await connect(again.wsUrl, session);
    const me = ready.profiles.find((p: any) => p.id === 'device-profile-1');
    assert.equal(me.frame, 'skulls');
    assert.equal(me.bio, 'ranked grind\n\nevery night');
    sock.close();
    await again.stop();
  });
});
