import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  VideoPreset,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type Participant,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteVideoTrack,
} from 'livekit-client';
import { app, setApp, toast } from '../state/store';
import { api } from './api';
import { MicPipeline, type MicOptions } from './mic';
import { bridge, isDesktop } from './platform';
import { settings, useSettings, type Resolution } from './settings';
import { sounds } from './sounds';
import { pickCodec, startAppAudio, type AppAudio } from './streaming';
import { AutoQuality, BITRATES, MIDDLE_LAYER_MBPS, RESOLUTIONS, ladder, tierLabel, type Sample, type Tier } from './quality';

// One voice channel at a time: a LiveKit room, our processed mic, remote audio
// playback with per-person volume, and Go Live streams.

let room: Room | null = null;
let mic: MicPipeline | null = null;
let micStarting: Promise<MicPipeline> | null = null;
let micPub: LocalTrackPublication | null = null;
let micTesting = false;
let appAudio: AppAudio | null = null;
let appAudioPub: LocalTrackPublication | null = null;
let pingTimer: number | null = null;
let rejoinAttempts = 0;
let leaving = false;
let localSpeaking = false;
let notify: () => void = () => {};
const audioEls = new Map<string, HTMLMediaElement[]>();

/** Called whenever voice state changes that others should see (channel, mute, live). */
export function onVoiceStateChange(cb: () => void): void {
  notify = cb;
}

export const currentRoom = () => room;

function micOptions(): MicOptions {
  const s = settings();
  return {
    deviceId: s.inputDevice,
    inputVolume: s.inputVolume,
    noise: s.noise,
    echoCancellation: s.echoCancellation,
    autoGain: s.autoGain,
    mode: s.inputMode,
    autoSensitivity: s.autoSensitivity,
    sensitivity: s.sensitivity,
    pttRelease: s.pttRelease,
  };
}

export async function getMic(): Promise<MicPipeline> {
  if (mic) return mic;
  micStarting ??= MicPipeline.create(micOptions())
    .then((m) => {
      mic = m;
      m.setMuted(app().muted || app().deafened);
      void m.setOutputDevice(settings().outputDevice);
      m.onLevel((level) => {
        setApp({ micLevel: level });
        const speaking = level.open && level.db > level.threshold - 4;
        if (speaking !== localSpeaking) {
          localSpeaking = speaking;
          setApp((s) => ({ members: s.members.map((x) => (x.isLocal ? { ...x, speaking } : x)) }));
        }
      });
      return m;
    })
    .finally(() => {
      micStarting = null;
    });
  return micStarting;
}

async function releaseMicIfIdle(): Promise<void> {
  if (room || micTesting || !mic) return;
  const m = mic;
  mic = null;
  localSpeaking = false;
  await m.destroy();
}

/** Mic test from settings: hear yourself the way friends do. */
export async function setMicTest(on: boolean): Promise<void> {
  micTesting = on;
  if (on) (await getMic()).setMonitor(true);
  else {
    mic?.setMonitor(false);
    await releaseMicIfIdle();
  }
}

function parseColor(metadata: string | undefined): string | null {
  try {
    const color = JSON.parse(metadata ?? '{}').color;
    return typeof color === 'string' ? color : null;
  } catch {
    return null;
  }
}

/** Rebuilds the member list and streams from the LiveKit room plus presence info. */
export function refresh(): void {
  if (!room) return;
  const r = room;
  const presence = new Map(app().users.map((u) => [u.id, u]));
  const people: Participant[] = [r.localParticipant, ...r.remoteParticipants.values()];
  const s = app();

  const members = people
    .map((p) => {
      const isLocal = p === r.localParticipant;
      const pres = presence.get(p.identity);
      const micPublication = p.getTrackPublication(Track.Source.Microphone);
      return {
        id: p.identity,
        name: pres?.name ?? p.name ?? 'friend',
        color: pres?.color ?? parseColor(p.metadata) ?? '#8b919d',
        isLocal,
        speaking: isLocal ? localSpeaking : p.isSpeaking,
        micMuted: isLocal ? s.muted || s.deafened : !micPublication || micPublication.isMuted || Boolean(pres?.muted),
        streaming: Boolean(p.getTrackPublication(Track.Source.ScreenShare)),
        joinedAt: p.joinedAt?.getTime() ?? 0,
      };
    })
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map(({ joinedAt: _j, ...m }) => m);

  const streams = people
    .filter((p) => p.getTrackPublication(Track.Source.ScreenShare))
    .map((p) => {
      const isLocal = p === r.localParticipant;
      const pub = p.getTrackPublication(Track.Source.ScreenShare)!;
      const live = isLocal ? s.myLive : presence.get(p.identity)?.live;
      const member = members.find((m) => m.id === p.identity);
      return {
        id: p.identity,
        name: member?.name ?? 'friend',
        color: member?.color ?? '#8b919d',
        isLocal,
        track: (pub.track as RemoteVideoTrack | LocalVideoTrack | undefined) ?? null,
        title: live?.title ?? 'Screen',
        quality: live?.quality ?? '',
      };
    });

  // You only watch a stream when you choose to; nothing starts by itself.
  // If one of two side-by-side streams ends, the other takes the whole stage.
  const exists = (id: string | null) => id !== null && streams.some((x) => x.id === id);
  let focus = s.focus;
  let focus2 = exists(s.focus2) ? s.focus2 : null;
  if (!exists(focus)) {
    focus = focus2;
    focus2 = null;
  }
  if (focus2 === focus) focus2 = null;
  const focusChanged = focus !== s.focus || focus2 !== s.focus2;
  setApp({ members, streams, focus, focus2 });
  if (focusChanged) applyAllSubscriptions();
}

// Download only what you're using: everyone's mic, and the video and sound of
// the one stream you're watching. Other streams cost nothing until you click Watch.
function applySubscriptions(p: RemoteParticipant): void {
  const { focus, focus2 } = app();
  const watched = focus === p.identity || focus2 === p.identity;
  for (const pub of p.trackPublications.values()) {
    const want =
      pub.source === Track.Source.Microphone ||
      ((pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio) && watched);
    if (pub.isSubscribed !== want) pub.setSubscribed(want);
  }
}

function applyAllSubscriptions(): void {
  room?.remoteParticipants.forEach(applySubscriptions);
}

/**
 * Volume slider (0–200%) to gain. Below 100% it simply turns down; above,
 * each step counts for more so a boost is clearly heard: 200% is +12 dB
 * (4×), roughly twice as loud.
 */
export function volumeGain(percent: number): number {
  if (percent <= 100) return Math.max(0, percent) / 100;
  return 10 ** (((Math.min(percent, 200) - 100) / 100) * (12 / 20));
}

// Remote audio plays through our own AudioContext so volumes can go above 100%.
let mixContext: AudioContext | null = null;
const boosts = new WeakMap<RemoteAudioTrack, { gain: GainNode; limiter: DynamicsCompressorNode }>();

/**
 * Plays one person's voice or stream sound at `volume` (1 = as sent). Above 1
 * the boost happens in our own gain, followed by a limiter just under full
 * scale, so loud moments can't crackle. (A compressor with a low threshold
 * adds its own make-up gain; one at -1 dB barely does.)
 */
function playAt(p: RemoteParticipant, source: Track.Source.Microphone | Track.Source.ScreenShareAudio, volume: number): void {
  const track = p.getTrackPublication(source)?.track as RemoteAudioTrack | undefined;
  const ctx = mixContext;
  const boost = track ? boosts.get(track) : undefined;
  if (!track || !ctx || volume <= 1) {
    if (track && boost) {
      track.setWebAudioPlugins([]);
      boosts.delete(track);
    }
    p.setVolume(volume, source);
    return;
  }
  let b = boost;
  if (!b) {
    const gain = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    b = { gain, limiter };
    boosts.set(track, b);
    track.setWebAudioPlugins([gain, limiter]);
  }
  b.gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  p.setVolume(1, source);
}

export function applyVolumes(): void {
  if (!room) return;
  const s = settings();
  const output = volumeGain(s.outputVolume);
  // Deafen silences people's voices only; streams keep their sound (each has its own mute).
  const voices = app().deafened ? 0 : output;
  room.remoteParticipants.forEach((p) => {
    const voice = (s.userMuted[p.identity] ? 0 : volumeGain(s.userVolumes[p.identity] ?? 100)) * voices;
    const stream = volumeGain(s.streamVolumes[p.identity] ?? 100) * output;
    playAt(p, Track.Source.Microphone, voice);
    playAt(p, Track.Source.ScreenShareAudio, stream);
  });
}

function attachAudio(track: RemoteTrack): void {
  if (track.kind !== Track.Kind.Audio || !track.sid) return;
  const el = track.attach();
  el.style.display = 'none';
  document.body.appendChild(el);
  audioEls.set(track.sid, [...(audioEls.get(track.sid) ?? []), el]);
}

function detachAudio(track: RemoteTrack): void {
  if (!track.sid) return;
  track.detach().forEach((el) => el.remove());
  audioEls.delete(track.sid);
}

function startPing(): void {
  stopPing();
  pingTimer = window.setInterval(() => {
    const rtt = (room?.engine as { client?: { rtt?: number } } | undefined)?.client?.rtt;
    if (typeof rtt === 'number' && rtt > 0) setApp((s) => ({ pings: [...s.pings.slice(-23), Math.round(rtt)] }));
  }, 2000);
}

function stopPing(): void {
  if (pingTimer) window.clearInterval(pingTimer);
  pingTimer = null;
}

function wireRoom(r: Room): void {
  r.on(RoomEvent.ParticipantConnected, (p) => {
    applySubscriptions(p);
    applyVolumes();
    sounds.join();
    refresh();
  })
    .on(RoomEvent.ParticipantDisconnected, () => {
      sounds.leave();
      refresh();
    })
    .on(RoomEvent.TrackPublished, (pub, p) => {
      if (pub.source === Track.Source.ScreenShare) {
        sounds.streamStart();
        toast(`${p.name || 'Someone'} went live. Click Watch on their tile to tune in.`);
      }
      applySubscriptions(p);
      refresh();
    })
    .on(RoomEvent.TrackUnpublished, (pub) => {
      if (pub.source === Track.Source.ScreenShare) sounds.streamStop();
      refresh();
    })
    .on(RoomEvent.TrackSubscribed, (track) => {
      attachAudio(track);
      applyVolumes();
      refresh();
    })
    .on(RoomEvent.TrackUnsubscribed, (track) => {
      detachAudio(track);
      refresh();
    })
    .on(RoomEvent.TrackMuted, () => refresh())
    .on(RoomEvent.TrackUnmuted, () => refresh())
    .on(RoomEvent.ActiveSpeakersChanged, () => refresh())
    .on(RoomEvent.ParticipantNameChanged, () => refresh())
    .on(RoomEvent.LocalTrackUnpublished, (pub) => {
      // Capture ended outside the app (window closed, "Stop sharing" clicked).
      if (pub.source === Track.Source.ScreenShare && app().myLive) void stopStream();
    })
    .on(RoomEvent.Reconnecting, () => setApp({ voiceStatus: 'reconnecting' }))
    .on(RoomEvent.Reconnected, () => setApp({ voiceStatus: 'connected' }))
    .on(RoomEvent.Disconnected, (reason) => {
      if (leaving || room !== r) return;
      const channel = app().voiceChannel;
      void leaveVoice({ silent: true });
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
        toast('You joined voice from another device', 'warn');
      } else if (channel && rejoinAttempts < 5) {
        rejoinAttempts += 1;
        toast('Voice dropped. Reconnecting…', 'warn');
        window.setTimeout(() => void joinVoice(channel), 1500 * rejoinAttempts);
      }
    })
    .on(RoomEvent.MediaDevicesError, (err) => toast(`Audio device problem: ${err.message}`, 'warn'));
}

export async function joinVoice(channelId: string): Promise<void> {
  if (room && app().voiceChannel === channelId) {
    setApp({ view: 'voice' });
    return;
  }
  const session = settings().session;
  if (!session) return;
  if (room) await leaveVoice({ silent: true });

  setApp({ voiceChannel: channelId, voiceStatus: 'connecting', view: 'voice', members: [], streams: [], focus: null, focus2: null, fullscreen: false, pings: [] });
  notify();

  void mixContext?.close().catch(() => {});
  mixContext = new AudioContext({ latencyHint: 'interactive' });
  const r = new Room({
    adaptiveStream: true,
    dynacast: true,
    webAudioMix: { audioContext: mixContext },
    disconnectOnPageLeave: true,
  });
  room = r;
  leaving = false;
  wireRoom(r);

  try {
    const { token, url } = await api.voiceToken(channelId, session);
    await r.connect(url, token, { autoSubscribe: false });
    if (room !== r) {
      await r.disconnect(false);
      return;
    }
    r.remoteParticipants.forEach(applySubscriptions);
    applyVolumes();
    const out = settings().outputDevice;
    if (out && out !== 'default') await r.switchActiveDevice('audiooutput', out).catch(() => {});
    rejoinAttempts = 0;
    setApp({ voiceStatus: 'connected' });
    refresh();
    startPing();
    sounds.join();
    // Hear everyone right away; the mic joins as soon as it's ready (or after the permission prompt).
    void publishMic().then((ok) => {
      if (ok || room !== r) return;
      // No mic (blocked or missing): stay in to listen and watch streams.
      setApp({ muted: true });
      refresh();
      notify();
      toast('No microphone access, so you joined listen-only. Unmute to try again.', 'warn');
    });
  } catch (err) {
    if (room === r) {
      room = null;
      await r.disconnect(false).catch(() => {});
      setApp({ voiceChannel: null, voiceStatus: 'idle', members: [], streams: [], view: 'text' });
      await releaseMicIfIdle();
    }
    const message = err instanceof Error ? err.message : String(err);
    toast(/Permission|NotAllowed/i.test(message) ? 'Microphone access was blocked. Allow it and try again.' : `Couldn't join voice: ${message}`, 'warn');
  }
  notify();
}

/** Publishes the processed mic into the current room. False if the mic can't be opened. */
async function publishMic(): Promise<boolean> {
  const r = room;
  if (!r || micPub) return Boolean(micPub);
  let m: MicPipeline;
  try {
    m = await getMic();
  } catch {
    return false;
  }
  if (room !== r) return false;
  micPub = await r.localParticipant.publishTrack(m.track, {
    source: Track.Source.Microphone,
    name: 'mic',
    dtx: true,
    red: settings().packetLossProtection,
    audioPreset: { maxBitrate: 64_000 },
  });
  if (app().muted || app().deafened) await micPub.mute();
  return true;
}

export async function leaveVoice(opts: { silent?: boolean } = {}): Promise<void> {
  const r = room;
  if (!r) return;
  leaving = true;
  stopPing();
  await stopStream(true);
  if (micPub?.track) await r.localParticipant.unpublishTrack(micPub.track, false).catch(() => {});
  micPub = null;
  room = null;
  await r.disconnect(false).catch(() => {});
  for (const els of audioEls.values()) els.forEach((el) => el.remove());
  audioEls.clear();
  void mixContext?.close().catch(() => {});
  mixContext = null;
  setApp((s) => ({
    voiceChannel: null,
    voiceStatus: 'idle',
    members: [],
    streams: [],
    focus: null,
    focus2: null,
    pings: [],
    fullscreen: false,
    view: s.view === 'voice' ? 'text' : s.view,
  }));
  if (!opts.silent) sounds.leave();
  await releaseMicIfIdle();
  notify();
}

export function setMuted(muted: boolean): void {
  const deafened = app().deafened && muted;
  if (!muted && room && !micPub) {
    // Joined listen-only earlier: try the mic again now.
    void publishMic().then((ok) => {
      if (!ok) toast('Still no microphone access. Check your system or browser permissions.', 'warn');
      else setMuted(false);
    });
    return;
  }
  setApp({ muted, deafened });
  syncMicMute();
  applyVolumes();
  (muted ? sounds.mute : sounds.unmute)();
  refresh();
  notify();
}

export function setDeafened(deafened: boolean): void {
  setApp({ deafened });
  syncMicMute();
  applyVolumes();
  (deafened ? sounds.mute : sounds.unmute)();
  refresh();
  notify();
}

function syncMicMute(): void {
  const off = app().muted || app().deafened;
  mic?.setMuted(off);
  if (micPub) void (off ? micPub.mute() : micPub.unmute());
}

/** Watch this stream on the main stage (null: watch nothing). */
export function setFocus(id: string | null): void {
  setApp((s) => ({ focus: id, focus2: id === null || s.focus2 === id ? null : s.focus2 }));
  applyAllSubscriptions();
}

/** Watch a second stream next to the one on stage. */
export function watchSideBySide(id: string): void {
  const s = app();
  if (!s.focus) return setFocus(id);
  if (id === s.focus) return;
  setApp({ focus2: id });
  applyAllSubscriptions();
}

/** Stop watching one stream; if two were side by side, the other fills the stage. */
export function stopWatching(id: string): void {
  const s = app();
  if (s.focus2 === id) setApp({ focus2: null });
  else if (s.focus === id) setApp({ focus: s.focus2, focus2: null });
  applyAllSubscriptions();
}

export type StreamRequest = {
  sourceId: string | null; // desktop: picked window/screen
  title: string;
  res: Resolution;
  fps: 30 | 60;
  mode: 'game' | 'screen';
  audio: boolean;
};

export async function startStream(req: StreamRequest): Promise<boolean> {
  const r = room;
  if (!r) return false;
  const { width, height } = RESOLUTIONS[req.res];
  const mbps = BITRATES[req.res][req.fps];
  const codec = await pickCodec(req.res, req.fps, settings().codecPref);
  if (bridge && req.sourceId) await bridge.selectCaptureSource(req.sourceId);

  let pub: LocalTrackPublication | undefined;
  try {
    pub = await r.localParticipant.setScreenShareEnabled(
      true,
      {
        // Desktop captures sound per app (below); the web build uses the browser's own option.
        audio: !isDesktop && req.audio,
        resolution: { width, height, frameRate: req.fps },
        contentHint: req.mode === 'game' ? 'motion' : 'detail',
        systemAudio: req.audio ? 'include' : 'exclude',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        suppressLocalAudioPlayback: false,
      },
      {
        videoCodec: codec.codec,
        screenShareEncoding: { maxBitrate: mbps * 1_000_000, maxFramerate: req.fps, priority: 'high' },
        // Never below 720p: the only backup layer is 720p (none for a 720p stream),
        // and the picture keeps its size under pressure; auto quality steps it down.
        simulcast: req.res !== '720p',
        screenShareSimulcastLayers: req.res === '720p' ? [] : [new VideoPreset(1280, 720, MIDDLE_LAYER_MBPS[req.fps] * 1_000_000, req.fps)],
        degradationPreference: 'maintain-resolution',
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/Permission|NotAllowed|AbortError/i.test(message)) toast(`Couldn't start the stream: ${message}`, 'warn');
    return false;
  }
  if (!pub) return false;

  let title = req.title;
  if (!isDesktop) {
    const surface = (pub.track?.mediaStreamTrack.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
    title = surface === 'window' ? 'A window' : surface === 'browser' ? 'A browser tab' : 'Screen';
  }

  if (isDesktop && req.audio && req.sourceId) {
    const audio = await startAppAudio(req.sourceId);
    if ('error' in audio) {
      toast(audio.error, 'warn');
    } else {
      appAudio = audio;
      appAudioPub = await r.localParticipant.publishTrack(audio.track, {
        source: Track.Source.ScreenShareAudio,
        name: 'stream-audio',
        dtx: false,
        red: false,
        forceStereo: true,
        audioPreset: { maxBitrate: 128_000 },
      });
    }
  }

  const quality = qualityText({ res: req.res, fps: req.fps, mbps }, codec, false);
  // Show your own preview, next to whatever you're already watching.
  const me = r.localParticipant.identity;
  const watchingOther = app().focus && app().focus !== me;
  setApp(watchingOther ? { myLive: { title, quality }, focus2: me } : { myLive: { title, quality }, focus: me });
  sounds.streamStart();
  if (pub.track) startAutoQuality(pub.track as LocalVideoTrack, req, codec);
  if (pub.track && bridge && req.sourceId?.startsWith('window:')) void startFollowing(pub.track as LocalVideoTrack, req);
  refresh();
  notify();
  return true;
}

function qualityText(t: Tier, codec: { label: string; hardware: boolean }, auto: boolean): string {
  return `${tierLabel(t)}${auto ? ' (auto)' : ''} · ${codec.label}${codec.hardware ? '' : ' (CPU)'} · ${t.mbps} Mbps`;
}

// ---- Follow the game ----
// A game's window closes when a match ends (League goes back to its client).
// Instead of ending the stream, move it to the same game's other window, and
// back to the game when the next match opens. With nothing to show, hold a
// "Waiting for the game" picture for a minute before ending.

type Following = {
  track: LocalVideoTrack;
  req: StreamRequest;
  current: string;
  seen: Set<string>;
  waiting: { track: MediaStreamTrack; stop: () => void; since: number } | null;
  timer: number;
  busy: boolean;
};

let following: Following | null = null;
const FOLLOW_EVERY_MS = 3000;
const WAIT_FOR_GAME_MS = 60_000;

/** A video track of one window, with no click needed (getDisplayMedia may want one). */
async function captureWindow(sourceId: string, req: StreamRequest): Promise<MediaStreamTrack> {
  const { width, height } = RESOLUTIONS[req.res];
  await bridge!.selectCaptureSource(sourceId);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { width, height, frameRate: req.fps }, audio: false });
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: width, maxHeight: height, maxFrameRate: req.fps } },
    } as unknown as MediaStreamConstraints);
  }
  const track = stream.getVideoTracks()[0]!;
  track.contentHint = req.mode === 'game' ? 'motion' : 'detail';
  return track;
}

/** The voice library ends the stream when the captured window closes; handle that here instead. */
function watchCaptureEnd(f: Following): void {
  const lk = f.track as unknown as { handleEnded?: EventListener };
  if (lk.handleEnded) f.track.mediaStreamTrack.removeEventListener('ended', lk.handleEnded);
  f.track.mediaStreamTrack.addEventListener('ended', () => void onCaptureEnded(f), { once: true });
}

function waitingPicture(title: string): { track: MediaStreamTrack; stop: () => void; since: number } {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;
  const draw = () => {
    ctx.fillStyle = '#0a0b0e';
    ctx.fillRect(0, 0, 1280, 720);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eef0f4';
    ctx.font = '700 46px system-ui, sans-serif';
    ctx.fillText('Waiting for the game…', 640, 345);
    ctx.fillStyle = '#8b919d';
    ctx.font = '500 28px system-ui, sans-serif';
    ctx.fillText(title, 640, 400);
  };
  draw();
  // The picture has to be redrawn to keep sending frames.
  const timer = window.setInterval(draw, 500);
  const track = canvas.captureStream(4).getVideoTracks()[0]!;
  return { track, since: Date.now(), stop: () => { window.clearInterval(timer); track.stop(); } };
}

/** Moves the live stream (and its game sound) to another window, without viewers noticing. */
async function switchCapture(f: Following, sourceId: string): Promise<void> {
  const next = await captureWindow(sourceId, f.req);
  const old = f.track.mediaStreamTrack;
  await f.track.replaceTrack(next, true);
  if (old !== f.waiting?.track) old.stop();
  f.waiting?.stop();
  f.waiting = null;
  f.current = sourceId;
  f.seen.add(sourceId);
  watchCaptureEnd(f);
  await reapplyQuality?.();
  // The game's own sound follows the window.
  const r = room;
  if (appAudio && appAudioPub?.track && r) {
    await appAudio.stop();
    const audio = await startAppAudio(sourceId);
    if ('error' in audio) {
      appAudio = null;
      await r.localParticipant.unpublishTrack(appAudioPub.track, true).catch(() => {});
      appAudioPub = null;
    } else {
      appAudio = audio;
      await appAudioPub.track.replaceTrack(audio.track, true).catch(() => {});
    }
  }
}

async function onCaptureEnded(f: Following): Promise<void> {
  if (following !== f) return;
  const found = await bridge!.followFind().catch(() => null);
  try {
    if (found && found.id !== f.current) {
      await switchCapture(f, found.id);
      return;
    }
  } catch {
    // fall through to waiting
  }
  // Nothing to show yet: hold a waiting picture; the next check picks the game up.
  f.waiting = waitingPicture(app().myLive?.title ?? '');
  await f.track.replaceTrack(f.waiting.track, true).catch(() => {});
}

async function followTick(f: Following): Promise<void> {
  if (following !== f || f.busy) return;
  f.busy = true;
  try {
    const found = await bridge!.followFind().catch(() => null);
    if (f.waiting) {
      if (found) await switchCapture(f, found.id);
      else if (Date.now() - f.waiting.since > WAIT_FOR_GAME_MS) {
        await stopStream();
        toast('The game closed, so your stream ended.');
      }
    } else if (found?.isGame && found.id !== f.current && !f.seen.has(found.id)) {
      // A new match opened while you streamed the client: show the game.
      await switchCapture(f, found.id);
    }
  } catch {
    // try again next time
  } finally {
    f.busy = false;
  }
}

async function startFollowing(track: LocalVideoTrack, req: StreamRequest): Promise<void> {
  stopFollowing();
  if (!(await bridge!.followStart(req.sourceId!).catch(() => false))) return;
  const f: Following = { track, req, current: req.sourceId!, seen: new Set([req.sourceId!]), waiting: null, timer: 0, busy: false };
  // Game windows already open don't pull the stream away from what you picked.
  const open = await bridge!.followFind().catch(() => null);
  if (open) f.seen.add(open.id);
  f.timer = window.setInterval(() => void followTick(f), FOLLOW_EVERY_MS);
  following = f;
  watchCaptureEnd(f);
}

function stopFollowing(): void {
  if (!following) return;
  window.clearInterval(following.timer);
  following.waiting?.stop();
  following = null;
  void bridge?.followStop();
}

// ---- Auto quality ----
// Every 2 seconds, look at how the outgoing stream is doing. If the upload or
// the PC holds it back for a few seconds, step down a level (never below 720p);
// when there's clearly room again, step back up.

let qualityTimer: number | null = null;

function stopAutoQuality(): void {
  if (qualityTimer) window.clearInterval(qualityTimer);
  qualityTimer = null;
  reapplyQuality = null;
}

/**
 * Points the top layer of the stream at a quality level, and keeps the backup
 * layer at 720p for whatever size the captured window is.
 */
async function applyTier(track: LocalVideoTrack, topIndex: number, tier: Tier, sourceHeight: number): Promise<void> {
  const sender = track.sender;
  if (!sender) return;
  const params = sender.getParameters();
  const top = params.encodings?.[topIndex];
  if (!top) return;
  top.scaleResolutionDownBy = Math.max(1, sourceHeight / RESOLUTIONS[tier.res].height);
  top.maxBitrate = tier.mbps * 1_000_000;
  top.maxFramerate = tier.fps;
  params.encodings.forEach((e, i) => {
    if (i !== topIndex) e.scaleResolutionDownBy = Math.max(1, sourceHeight / RESOLUTIONS['720p'].height);
  });
  await sender.setParameters(params).catch(() => {});
}

/** Re-sizes the stream's layers after the captured window changed (follow the game). */
let reapplyQuality: (() => Promise<void>) | null = null;

function startAutoQuality(track: LocalVideoTrack, req: StreamRequest, codec: { label: string; hardware: boolean }): void {
  stopAutoQuality();
  const auto = new AutoQuality(ladder(req.res, req.fps));
  const chosen = tierLabel(auto.tier);
  setApp({ streamHealth: { tier: chosen, chosen, reason: null } });

  // The full-quality layer is the one allowed the most bitrate.
  const encodings = track.sender?.getParameters().encodings ?? [];
  const topIndex = encodings.reduce((best, e, i) => ((e.maxBitrate ?? 0) > (encodings[best]?.maxBitrate ?? 0) ? i : best), 0);
  const sourceHeight = () => track.mediaStreamTrack.getSettings().height ?? RESOLUTIONS[req.res].height;
  reapplyQuality = () => applyTier(track, topIndex, auto.tier, sourceHeight());
  void reapplyQuality();
  if (auto.tiers.length < 2) return;
  let told = false;

  qualityTimer = window.setInterval(async () => {
    const report = await track.sender?.getStats().catch(() => null);
    if (!report) return;
    let limitedBy: Sample['limitedBy'] = 'none';
    let available = 0;
    let sending = false;
    report.forEach((s: any) => {
      if (s.type === 'outbound-rtp' && s.kind === 'video' && (s.framesPerSecond ?? 0) > 0) {
        sending = true;
        if (s.qualityLimitationReason === 'bandwidth') limitedBy = 'bandwidth';
        else if (s.qualityLimitationReason === 'cpu' && limitedBy === 'none') limitedBy = 'cpu';
      }
      if (s.type === 'candidate-pair' && s.nominated && s.availableOutgoingBitrate) available = s.availableOutgoingBitrate / 1e6;
    });
    // Nobody watching means nothing is sent, and nothing to judge.
    if (!sending || !auto.next({ limitedBy, available })) return;

    await applyTier(track, topIndex, auto.tier, sourceHeight());
    const now = tierLabel(auto.tier);
    setApp((s) => ({
      streamHealth: { tier: now, chosen, reason: auto.reason },
      myLive: s.myLive ? { ...s.myLive, quality: qualityText(auto.tier, codec, auto.lowered) } : null,
    }));
    notify();
    if (auto.lowered && !told) {
      told = true;
      toast(
        auto.reason === 'pc'
          ? `Your PC is busy, so your stream stepped down to ${now} to stay smooth.`
          : `Your upload is busy, so your stream stepped down to ${now}. It goes back up when there's room.`,
        'warn',
      );
    }
  }, 2000);
}

export async function stopStream(silent = false): Promise<void> {
  const r = room;
  stopFollowing();
  stopAutoQuality();
  setApp({ streamHealth: null });
  if (appAudioPub?.track && r) await r.localParticipant.unpublishTrack(appAudioPub.track, true).catch(() => {});
  appAudioPub = null;
  const audio = appAudio;
  appAudio = null;
  await audio?.stop();
  if (r?.localParticipant.isScreenShareEnabled) await r.localParticipant.setScreenShareEnabled(false).catch(() => {});
  if (app().myLive) {
    setApp({ myLive: null });
    if (!silent) sounds.streamStop();
  }
  refresh();
  notify();
}

// ---- wiring that lives for the whole app ----

let initialized = false;

export function initVoice(): void {
  if (initialized) return;
  initialized = true;

  // Apply settings changes to the live mic and room.
  useSettings.subscribe((s, prev) => {
    if (mic) {
      void mic.update({
        deviceId: s.inputDevice,
        inputVolume: s.inputVolume,
        noise: s.noise,
        echoCancellation: s.echoCancellation,
        autoGain: s.autoGain,
        mode: s.inputMode,
        autoSensitivity: s.autoSensitivity,
        sensitivity: s.sensitivity,
        pttRelease: s.pttRelease,
      }).catch((err) => toast(`Microphone problem: ${err instanceof Error ? err.message : err}`, 'warn'));
    }
    if (s.outputDevice !== prev.outputDevice) {
      void mic?.setOutputDevice(s.outputDevice);
      void room?.switchActiveDevice('audiooutput', s.outputDevice).catch(() => {});
    }
    if (s.userVolumes !== prev.userVolumes || s.userMuted !== prev.userMuted || s.streamVolumes !== prev.streamVolumes || s.outputVolume !== prev.outputVolume) {
      applyVolumes();
      refresh();
    }
    if (s.inputMode !== prev.inputMode || s.pttDesktop !== prev.pttDesktop) syncPttBinding();
  });

  // Push-to-talk: global hook on desktop, in-window keys on the web.
  syncPttBinding();
  bridge?.onPtt((pressed) => mic?.setPtt(pressed));
  if (!bridge) {
    const matches = (e: KeyboardEvent) => settings().inputMode === 'ptt' && settings().pttWeb?.code === e.code;
    window.addEventListener('keydown', (e) => {
      if (matches(e) && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) mic?.setPtt(true);
    });
    window.addEventListener('keyup', (e) => {
      if (matches(e)) mic?.setPtt(false);
    });
    window.addEventListener('blur', () => mic?.setPtt(false));
  }

  bridge?.onTrayAction((action) => {
    if (action === 'toggle-mute') setMuted(!app().muted);
    if (action === 'toggle-deafen') setDeafened(!app().deafened);
    if (action === 'disconnect') void leaveVoice();
  });
}

function syncPttBinding(): void {
  const s = settings();
  void bridge?.setPttBinding(s.inputMode === 'ptt' ? s.pttDesktop : null);
}
