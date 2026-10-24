// End-to-end check against a running stack (scripts/local-stack.sh start, or a real server):
// two bots log in through the gateway, join a voice channel through Caddy -> LiveKit,
// one publishes a mic (sine tone) and a 1080p screen share, the other must receive both.
//
//   E2E_BASE=http://localhost:8088 E2E_PASSWORD=... E2E_CODEC=VP8|H264|VP9|AV1 npm run e2e
import {
  AudioFrame, AudioSource, AudioStream, dispose, LocalAudioTrack, LocalVideoTrack,
  RemoteAudioTrack, RemoteVideoTrack, Room, RoomEvent, TrackPublishOptions, TrackSource,
  VideoBufferType, VideoCodec, VideoFrame, VideoSource, VideoStream,
  type RemoteParticipant, type RemoteTrack,
} from '@livekit/rtc-node';

const BASE = process.env.E2E_BASE ?? 'http://localhost:8088';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const CODEC = (process.env.E2E_CODEC ?? 'VP8').toUpperCase() as keyof typeof VideoCodec;
const ROOM = 'gaming';
const W = 1920;
const H = 1080;
const FPS = 30;
const SECONDS = 6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = false;
function check(ok: boolean, what: string): void {
  console.log(`  ${ok ? '✔' : '✘'} ${what}`);
  if (!ok) failed = true;
}

async function api(path: string, body: unknown, session?: string) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function loginAndToken(name: string, deviceId: string) {
  const login = await api('/api/login', { name, deviceId, password: PASSWORD });
  if (login.status !== 200) throw new Error(`login failed for ${name}: ${login.status} ${JSON.stringify(login.body)}`);
  const token = await api('/api/token', { room: ROOM }, login.body.session);
  if (token.status !== 200) throw new Error(`token failed for ${name}: ${token.status}`);
  return { session: login.body.session as string, token: token.body.token as string, url: token.body.url as string };
}

async function presenceCheck(session: string): Promise<boolean> {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
  return new Promise((resolve) => {
    const timer = setTimeout(() => { ws.close(); resolve(false); }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', session }));
    ws.onmessage = (ev) => {
      if (JSON.parse(String(ev.data)).t === 'ready') {
        clearTimeout(timer);
        ws.close();
        resolve(true);
      }
    };
  });
}

async function main() {
  console.log(`E2E against ${BASE}, video codec ${CODEC}`);

  const wrong = await api('/api/login', { name: 'x', deviceId: 'e2e-wrong-pass', password: 'definitely wrong' });
  check(wrong.status === 401, 'wrong password is rejected');

  const streamer = await loginAndToken('streamer-bot', 'e2e-streamer-0001');
  const viewer = await loginAndToken('viewer-bot', 'e2e-viewer-00001');
  check(true, 'two bots logged in and got LiveKit tokens');
  check(await presenceCheck(viewer.session), 'presence WebSocket works through Caddy');

  // ---- viewer: count what arrives ----
  const got = { audioFrames: 0, audioRms: 0, videoFrames: 0, maxWidth: 0, speaking: false, peer: null as RemoteParticipant | null };
  const viewerRoom = new Room();
  viewerRoom.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => { got.peer = p; });
  viewerRoom.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    if (speakers.some((s) => s.identity === 'e2e-streamer-0001')) got.speaking = true;
  });
  viewerRoom.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track instanceof RemoteAudioTrack) {
      (async () => {
        const reader = new AudioStream(track, 48000, 1).getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          got.audioFrames++;
          let sum = 0;
          for (const s of value.data) sum += s * s;
          got.audioRms = Math.max(got.audioRms, Math.sqrt(sum / value.data.length));
        }
      })().catch(() => {});
    }
    if (track instanceof RemoteVideoTrack) {
      (async () => {
        const reader = new VideoStream(track).getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          got.videoFrames++;
          got.maxWidth = Math.max(got.maxWidth, value.frame.width);
        }
      })().catch(() => {});
    }
  });
  await viewerRoom.connect(viewer.url, viewer.token, { autoSubscribe: true, dynacast: true });
  check(viewerRoom.isConnected, `viewer joined "${ROOM}" via ${viewer.url} (signalling through Caddy)`);

  // ---- streamer: mic tone + 1080p screen share ----
  const streamerRoom = new Room();
  await streamerRoom.connect(streamer.url, streamer.token, { autoSubscribe: true, dynacast: true });
  check(streamerRoom.isConnected, 'streamer joined');

  const audioSource = new AudioSource(48000, 1);
  const mic = LocalAudioTrack.createAudioTrack('mic', audioSource);
  await streamerRoom.localParticipant!.publishTrack(mic, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE, red: true, dtx: false }));

  const videoSource = new VideoSource(W, H);
  const screen = LocalVideoTrack.createVideoTrack('screen', videoSource);
  await streamerRoom.localParticipant!.publishTrack(screen, new TrackPublishOptions({
    source: TrackSource.SOURCE_SCREENSHARE,
    videoCodec: VideoCodec[CODEC],
    simulcast: true,
    videoEncoding: { maxBitrate: 8_000_000n, maxFramerate: FPS },
  }));
  check(true, `published mic + ${W}x${H}@${FPS} screen share (${CODEC}, simulcast)`);

  // Feed media in real time.
  const pixels = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      pixels[i] = (x * 255) / W; pixels[i + 1] = (y * 255) / H; pixels[i + 2] = 128; pixels[i + 3] = 255;
    }
  }
  const start = Date.now();
  let sample = 0;
  let frame = 0;
  while (Date.now() - start < SECONDS * 1000) {
    const elapsed = Date.now() - start;
    // Audio: 10 ms frames, 440 Hz tone.
    while (sample < (elapsed / 1000) * 48000) {
      const data = new Int16Array(480);
      for (let i = 0; i < 480; i++) data[i] = Math.round(Math.sin((2 * Math.PI * 440 * (sample + i)) / 48000) * 8000);
      sample += 480;
      await audioSource.captureFrame(new AudioFrame(data, 48000, 1, 480));
    }
    // Video: a bar sweeping across so every frame changes.
    while (frame < (elapsed / 1000) * FPS) {
      const bar = (frame * 24) % W;
      for (let y = 0; y < H; y += 2) {
        for (let x = bar; x < Math.min(bar + 24, W); x++) {
          const i = (y * W + x) * 4;
          pixels[i] = 255 - pixels[i]!; pixels[i + 1] = 255 - pixels[i + 1]!;
        }
      }
      videoSource.captureFrame(new VideoFrame(pixels, W, H, VideoBufferType.RGBA));
      frame++;
    }
    await sleep(5);
  }
  await sleep(500);

  check(got.peer?.name === 'streamer-bot', `viewer sees the streamer by name (${got.peer?.name})`);
  check(JSON.parse(got.peer?.metadata || '{}').color?.startsWith('#') === true, 'viewer sees the streamer avatar color from the token');
  check(got.audioFrames > 200 && got.audioRms > 1000, `viewer received audio (${got.audioFrames} frames, peak RMS ${Math.round(got.audioRms)})`);
  check(got.speaking, 'LiveKit flagged the streamer as speaking');
  check(got.videoFrames > FPS * 2, `viewer received video (${got.videoFrames} frames, widest layer ${got.maxWidth}px)`);

  await streamerRoom.disconnect();
  await viewerRoom.disconnect();
  await dispose();

  console.log(failed ? '\nE2E FAILED' : '\nE2E PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error('E2E crashed:', err);
  await dispose().catch(() => {});
  process.exit(1);
});
