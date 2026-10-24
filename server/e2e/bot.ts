// A stand-in friend for manual testing: logs in, joins a voice channel, talks
// (a tone that pulses on and off) and streams a 1080p test pattern for a while.
//
//   E2E_BASE=http://localhost:8088 E2E_PASSWORD=... BOT_NAME=nikos BOT_SECONDS=120 npm run bot
import {
  AudioFrame, AudioSource, dispose, LocalAudioTrack, LocalVideoTrack, Room, TrackPublishOptions,
  TrackSource, VideoBufferType, VideoCodec, VideoFrame, VideoSource,
} from '@livekit/rtc-node';

const BASE = process.env.E2E_BASE ?? 'http://localhost:8088';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const NAME = process.env.BOT_NAME ?? 'nikos';
const ROOM = process.env.BOT_ROOM ?? 'gaming';
const SECONDS = Number(process.env.BOT_SECONDS ?? 120);
const W = 1920;
const H = 1080;
const FPS = 30;

async function post(path: string, body: unknown, session?: string) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as any;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { session } = await post('/api/login', { name: NAME, deviceId: `bot-${NAME}-0001`, password: PASSWORD, color: '#ffb27a' });
  const { token, url } = await post('/api/token', { room: ROOM }, session);

  // Presence: tell everyone we're in voice and live.
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
  await new Promise<void>((resolve) => {
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', session }));
    ws.onmessage = (ev) => JSON.parse(String(ev.data)).t === 'ready' && resolve();
  });
  ws.send(JSON.stringify({ t: 'state', channel: ROOM, muted: false, deafened: false, live: { title: 'Test pattern', quality: '1080p30 · VP8 · 8 Mbps' } }));
  ws.send(JSON.stringify({ t: 'chat', channel: ROOM, text: `${NAME} here, streaming a test pattern`, nonce: 'bot' }));

  const room = new Room();
  await room.connect(url, token, { autoSubscribe: false, dynacast: true });

  const audioSource = new AudioSource(48000, 1);
  await room.localParticipant!.publishTrack(LocalAudioTrack.createAudioTrack('mic', audioSource), new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
  const videoSource = new VideoSource(W, H);
  await room.localParticipant!.publishTrack(
    LocalVideoTrack.createVideoTrack('screen', videoSource),
    new TrackPublishOptions({ source: TrackSource.SOURCE_SCREENSHARE, videoCodec: VideoCodec.VP8, simulcast: true, videoEncoding: { maxBitrate: 8_000_000n, maxFramerate: FPS } }),
  );
  console.log(`${NAME} is live in "${ROOM}" for ${SECONDS}s`);

  const pixels = new Uint8Array(W * H * 4);
  const start = Date.now();
  let sample = 0;
  let frame = 0;
  while (Date.now() - start < SECONDS * 1000) {
    const t = (Date.now() - start) / 1000;
    while (sample < t * 48000) {
      const data = new Int16Array(480);
      // Talk for 1.2 s, pause for 0.8 s, so the speaking ring pulses.
      const talking = (sample / 48000) % 2 < 1.2;
      for (let i = 0; i < 480; i++) data[i] = talking ? Math.round(Math.sin((2 * Math.PI * 330 * (sample + i)) / 48000) * 6000) : 0;
      sample += 480;
      await audioSource.captureFrame(new AudioFrame(data, 48000, 1, 480));
    }
    while (frame < t * FPS) {
      // A dark grid with a neon bar sweeping across.
      const bar = Math.floor(((frame * 16) % W));
      for (let y = 0; y < H; y += 1) {
        const row = y * W * 4;
        for (let x = 0; x < W; x += 1) {
          const i = row + x * 4;
          const grid = x % 120 === 0 || y % 120 === 0;
          const inBar = x >= bar && x < bar + 60;
          pixels[i] = inBar ? 45 : grid ? 40 : 14;
          pixels[i + 1] = inBar ? 226 : grid ? 44 : 16;
          pixels[i + 2] = inBar ? 255 : grid ? 54 : 22;
          pixels[i + 3] = 255;
        }
      }
      videoSource.captureFrame(new VideoFrame(pixels, W, H, VideoBufferType.RGBA));
      frame++;
    }
    await sleep(5);
  }

  ws.send(JSON.stringify({ t: 'state', channel: null }));
  ws.close();
  await room.disconnect();
  await dispose();
}

main().catch(async (err) => {
  console.error(err);
  await dispose().catch(() => {});
  process.exit(1);
});
