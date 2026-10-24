import { GtcrnWorkletNode, RnnoiseWorkletNode, loadGtcrn, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import gtcrnWorkletUrl from '@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url';
import gtcrnWasmUrl from '@sapphi-red/web-noise-suppressor/gtcrn.wasm?url';
import type { InputMode, NoiseLevel } from './settings';

// The microphone chain, all at 48 kHz:
//
//   mic -> input volume -> noise suppression (RNNoise / GTCRN / none) -> level meter
//       -> gate (voice activity or push-to-talk) -> the track sent to LiveKit
//
// The published track never changes; switching mics or noise settings rewires
// the nodes in front of it, so nobody hears a reconnect.

export type MicOptions = {
  deviceId: string;
  inputVolume: number; // %
  noise: NoiseLevel;
  echoCancellation: boolean;
  autoGain: boolean;
  mode: InputMode;
  autoSensitivity: boolean;
  sensitivity: number; // dB
  pttRelease: number; // ms
};

export type MicLevel = { db: number; open: boolean; threshold: number };

const VA_HOLD_MS = 280;
const TICK_MS = 30;

let rnnoiseBinary: Promise<ArrayBuffer> | null = null;
let gtcrnBinary: Promise<ArrayBuffer> | null = null;

export class MicPipeline {
  readonly ctx: AudioContext;
  readonly track: MediaStreamTrack;
  private opts: MicOptions;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private inputGain: GainNode;
  private denoiser: AudioWorkletNode | null = null;
  private analyser: AnalyserNode;
  private gate: GainNode;
  private monitor: GainNode;
  private dest: MediaStreamAudioDestinationNode;
  private samples: Float32Array<ArrayBuffer>;
  private timer: number | null = null;
  private muted = false;
  private pttPressed = false;
  private pttReleasedAt = 0;
  private lastVoiceAt = 0;
  private noiseFloor = -70;
  private open = false;
  private listeners = new Set<(level: MicLevel) => void>();

  private constructor(ctx: AudioContext, opts: MicOptions) {
    this.ctx = ctx;
    this.opts = opts;
    this.inputGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.samples = new Float32Array(this.analyser.fftSize);
    this.gate = ctx.createGain();
    this.gate.gain.value = 0;
    this.monitor = ctx.createGain();
    this.monitor.gain.value = 0;
    this.dest = ctx.createMediaStreamDestination();
    this.dest.channelCount = 1;
    this.analyser.connect(this.gate);
    this.gate.connect(this.dest);
    this.gate.connect(this.monitor);
    this.monitor.connect(ctx.destination);
    this.track = this.dest.stream.getAudioTracks()[0]!;
    this.setInputVolume(opts.inputVolume);
  }

  static async create(opts: MicOptions): Promise<MicPipeline> {
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    const mic = new MicPipeline(ctx, opts);
    await mic.openDevice();
    await mic.setNoise(opts.noise);
    mic.timer = window.setInterval(() => mic.tick(), TICK_MS);
    return mic;
  }

  onLevel(cb: (level: MicLevel) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Re-opens the microphone, e.g. after choosing another device or changing echo/gain settings. */
  async update(next: Partial<MicOptions>): Promise<void> {
    const prev = this.opts;
    this.opts = { ...prev, ...next };
    if (next.inputVolume !== undefined) this.setInputVolume(next.inputVolume);
    const reopen =
      (next.deviceId !== undefined && next.deviceId !== prev.deviceId) ||
      (next.echoCancellation !== undefined && next.echoCancellation !== prev.echoCancellation) ||
      (next.autoGain !== undefined && next.autoGain !== prev.autoGain);
    if (reopen) await this.openDevice();
    if (next.noise !== undefined && next.noise !== prev.noise) await this.setNoise(next.noise);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  setPtt(pressed: boolean): void {
    if (this.pttPressed && !pressed) this.pttReleasedAt = performance.now();
    this.pttPressed = pressed;
  }

  /** Plays your processed mic back to you (mic test). */
  setMonitor(on: boolean): void {
    this.monitor.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (ctx.setSinkId) await ctx.setSinkId(deviceId === 'default' ? '' : deviceId).catch(() => {});
  }

  get threshold(): number {
    return this.opts.autoSensitivity ? Math.min(-30, Math.max(-62, this.noiseFloor + 14)) : this.opts.sensitivity;
  }

  async destroy(): Promise<void> {
    if (this.timer) window.clearInterval(this.timer);
    this.listeners.clear();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.track.stop();
    (this.denoiser as { destroy?: () => void } | null)?.destroy?.();
    await this.ctx.close().catch(() => {});
  }

  private setInputVolume(percent: number): void {
    this.inputGain.gain.setTargetAtTime(Math.max(0, percent) / 100, this.ctx.currentTime, 0.02);
  }

  private async openDevice(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this.opts.deviceId && this.opts.deviceId !== 'default' ? { exact: this.opts.deviceId } : undefined,
        echoCancellation: this.opts.echoCancellation,
        autoGainControl: this.opts.autoGain,
        // Our own suppressor (or none, when the user picked Off) replaces the browser's.
        noiseSuppression: false,
        channelCount: 1,
        sampleRate: 48000,
      },
    });
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.inputGain);
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
  }

  private async setNoise(level: NoiseLevel): Promise<void> {
    let node: AudioWorkletNode | null = null;
    try {
      if (level === 'standard') {
        rnnoiseBinary ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
        const [bin] = await Promise.all([rnnoiseBinary, this.ctx.audioWorklet.addModule(rnnoiseWorkletUrl)]);
        node = new RnnoiseWorkletNode(this.ctx, { wasmBinary: bin, maxChannels: 1 });
      } else if (level === 'high') {
        gtcrnBinary ??= loadGtcrn({ url: gtcrnWasmUrl });
        const [bin] = await Promise.all([gtcrnBinary, this.ctx.audioWorklet.addModule(gtcrnWorkletUrl)]);
        node = new GtcrnWorkletNode(this.ctx, { wasmBinary: bin, maxChannels: 1 });
      }
    } catch (err) {
      console.warn('noise suppression unavailable, sending the raw mic', err);
      node = null;
    }
    this.inputGain.disconnect();
    if (this.denoiser) {
      this.denoiser.disconnect();
      (this.denoiser as { destroy?: () => void }).destroy?.();
    }
    this.denoiser = node;
    if (node) {
      this.inputGain.connect(node);
      node.connect(this.analyser);
    } else {
      this.inputGain.connect(this.analyser);
    }
  }

  private tick(): void {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) sum += this.samples[i]! * this.samples[i]!;
    const db = Math.max(-100, 20 * Math.log10(Math.sqrt(sum / this.samples.length) + 1e-9));
    const now = performance.now();

    // Track the room's background level for automatic sensitivity: fall fast, rise slowly.
    this.noiseFloor = db < this.noiseFloor ? db : this.noiseFloor + 0.05;

    const threshold = this.threshold;
    let open: boolean;
    if (this.muted) {
      open = false;
    } else if (this.opts.mode === 'ptt') {
      open = this.pttPressed || now - this.pttReleasedAt < this.opts.pttRelease;
    } else {
      if (db > threshold) this.lastVoiceAt = now;
      open = now - this.lastVoiceAt < VA_HOLD_MS;
    }

    if (open !== this.open) {
      this.open = open;
      this.gate.gain.setTargetAtTime(open ? 1 : 0, this.ctx.currentTime, open ? 0.005 : 0.03);
    }
    for (const cb of this.listeners) cb({ db, open, threshold });
  }
}

export async function listDevices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: devices.filter((d) => d.kind === 'audioinput' && d.deviceId),
    outputs: devices.filter((d) => d.kind === 'audiooutput' && d.deviceId),
  };
}
