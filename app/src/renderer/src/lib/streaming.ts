import type { VideoCodec } from 'livekit-client';
import { bridge } from './platform';
import type { Resolution } from './settings';

export const RESOLUTIONS: Record<Resolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
};

/** Target bitrates in Mbps. Viewers' connections decide how much of this they get. */
export const BITRATES: Record<Resolution, Record<30 | 60, number>> = {
  '720p': { 30: 3, 60: 5 },
  '1080p': { 30: 5, 60: 8 },
  '1440p': { 30: 10, 60: 16 },
};

/** Upload the streamer needs: the main stream plus the small preview layer and overhead. */
export function uploadNeeded(mbps: number): number {
  return Math.ceil(mbps * 1.1 + 1);
}

export type CodecChoice = { codec: VideoCodec; label: string; hardware: boolean };

async function hardwareEncodes(mime: string, width: number, height: number, fps: number, mbps: number): Promise<boolean> {
  try {
    const info = await navigator.mediaCapabilities.encodingInfo({
      type: 'webrtc',
      video: { contentType: mime, width, height, framerate: fps, bitrate: mbps * 1_000_000 },
    });
    return info.supported && info.powerEfficient;
  } catch {
    return false;
  }
}

/**
 * 1440p60 needs a hardware encoder to stay smooth, so pick by what this GPU can do:
 * AV1 (RTX 40/50, RX 7000+, Arc), then H.264, then VP9. Without any hardware
 * encoder, fall back to H.264 in software.
 */
export async function pickCodec(res: Resolution, fps: number, pref: 'auto' | 'h264'): Promise<CodecChoice> {
  const { width, height } = RESOLUTIONS[res];
  const mbps = BITRATES[res][fps as 30 | 60];
  if (pref === 'h264') {
    return { codec: 'h264', label: 'H.264', hardware: await hardwareEncodes('video/H264', width, height, fps, mbps) };
  }
  if (await hardwareEncodes('video/AV1', width, height, fps, mbps)) return { codec: 'av1', label: 'AV1', hardware: true };
  if (await hardwareEncodes('video/H264', width, height, fps, mbps)) return { codec: 'h264', label: 'H.264', hardware: true };
  if (await hardwareEncodes('video/VP9', width, height, fps, mbps)) return { codec: 'vp9', label: 'VP9', hardware: true };
  return { codec: 'h264', label: 'H.264', hardware: false };
}

// ---- Per-app stream sound (Windows desktop) ----
// The main process captures one program's audio (or everything except
// Gamespeaker) as 16-bit stereo PCM and streams it here; an AudioWorklet turns
// it back into a MediaStreamTrack we can publish.

const PCM_PLAYER = `
class GsPcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 48000 * 2 * 2;
    this.buf = new Float32Array(this.size);
    this.r = 0; this.w = 0; this.filled = 0;
    this.port.onmessage = (e) => {
      const s = new Int16Array(e.data);
      for (let i = 0; i < s.length; i++) {
        this.buf[this.w] = s[i] / 32768;
        this.w = (this.w + 1) % this.size;
      }
      this.filled = Math.min(this.size, this.filled + s.length);
      if (this.filled === this.size) this.r = this.w;
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    // Keep latency low: if more than 200 ms is queued, skip ahead to 60 ms.
    if (this.filled > 19200) { const drop = this.filled - 5760; this.r = (this.r + drop) % this.size; this.filled -= drop; }
    for (let i = 0; i < L.length; i++) {
      if (this.filled >= 2) {
        L[i] = this.buf[this.r]; R[i] = this.buf[(this.r + 1) % this.size];
        this.r = (this.r + 2) % this.size; this.filled -= 2;
      } else { L[i] = 0; R[i] = 0; }
    }
    return true;
  }
}
registerProcessor('gs-pcm-player', GsPcmPlayer);
`;

export type AppAudio = { track: MediaStreamTrack; stop: () => Promise<void> };

export async function startAppAudio(sourceId: string): Promise<AppAudio | { error: string }> {
  if (!bridge || !(await bridge.appAudioSupported())) return { error: 'Stream sound is only available on Windows for now.' };
  const status = await bridge.startAppAudio(sourceId);
  if (!status.ok) return { error: status.reason };

  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  const url = URL.createObjectURL(new Blob([PCM_PLAYER], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const node = new AudioWorkletNode(ctx, 'gs-pcm-player', { numberOfInputs: 0, outputChannelCount: [2] });
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 2;
  node.connect(dest);
  const off = bridge.onAppAudio((chunk) => node.port.postMessage(chunk, [chunk]));

  return {
    track: dest.stream.getAudioTracks()[0]!,
    stop: async () => {
      off();
      await bridge!.stopAppAudio();
      node.disconnect();
      await ctx.close().catch(() => {});
    },
  };
}
