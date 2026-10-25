import { GtcrnWorkletNode, RnnoiseWorkletNode, loadGtcrn, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import gtcrnWorkletUrl from '@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url';
import gtcrnWasmUrl from '@sapphi-red/web-noise-suppressor/gtcrn.wasm?url';
import { defaultDeviceName, onDevicesChanged, pickDevice, setContextOutput } from './devices';
import type { InputMode, NoiseLevel } from './settings';

// The microphone chain, all at 48 kHz:
//
//   mic -> input volume -> noise suppression (RNNoise / GTCRN / none) -> level meter
//       -> gate (voice activity or push-to-talk) -> the track sent to LiveKit
//
// The published track never changes; switching mics or noise settings rewires
// the nodes in front of it, so nobody hears a reconnect.
//
// When the PC is too busy for this chain to keep up (a game using every core),
// the voice it sends breaks up and buzzes. Then goDirect() sends the mic as
// the system captures it instead, with the browser's own noise suppression,
// and the chain above only measures the level for the voice gate.

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
  /** The input actually open: the chosen mic, or the default while it's unplugged. */
  private inputInUse = '';
  /** What "default" pointed at when it was opened. */
  private defaultName = '';
  private outputChoice = 'default';
  private destroyed = false;
  private offDevices: () => void = () => {};
  /** Direct mode: the mic itself is sent, gated by switching it on and off. */
  private direct = false;
  private directTrack: MediaStreamTrack | null = null;
  private sendListeners = new Set<(track: MediaStreamTrack) => void>();

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
    mic.offDevices = onDevicesChanged(() => void mic.devicesChanged());
    return mic;
  }

  /** The track to publish: the processed one, or in direct mode the mic itself. */
  get sendTrack(): MediaStreamTrack {
    return this.directTrack ?? this.track;
  }

  get isDirect(): boolean {
    return this.direct;
  }

  /** Called with the new track whenever sendTrack changes. */
  onSendTrack(cb: (track: MediaStreamTrack) => void): () => void {
    this.sendListeners.add(cb);
    return () => this.sendListeners.delete(cb);
  }

  /** Stop processing the mic here and send it straight from the system (see the top of this file). */
  async goDirect(): Promise<void> {
    if (this.direct || this.destroyed) return;
    this.direct = true;
    await this.setNoise('off');
    await this.openDevice();
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
    // Direct mode keeps the browser's suppression; the chosen one comes back next time you join.
    if (next.noise !== undefined && next.noise !== prev.noise && !this.direct) await this.setNoise(next.noise);
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
    this.outputChoice = deviceId;
    await setContextOutput(this.ctx, await pickDevice('audiooutput', deviceId));
  }

  get threshold(): number {
    return this.opts.autoSensitivity ? Math.min(-30, Math.max(-62, this.noiseFloor + 14)) : this.opts.sensitivity;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.offDevices();
    if (this.timer) window.clearInterval(this.timer);
    this.listeners.clear();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.track.stop();
    this.directTrack?.stop();
    this.sendListeners.clear();
    (this.denoiser as { destroy?: () => void } | null)?.destroy?.();
    await this.ctx.close().catch(() => {});
  }

  private setInputVolume(percent: number): void {
    this.inputGain.gain.setTargetAtTime(Math.max(0, percent) / 100, this.ctx.currentTime, 0.02);
  }

  private async openDevice(): Promise<void> {
    const device = await pickDevice('audioinput', this.opts.deviceId);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: device !== 'default' ? { exact: device } : undefined,
        echoCancellation: this.opts.echoCancellation,
        autoGainControl: this.opts.autoGain,
        // Our own suppressor (or none, when the user picked Off) replaces the browser's,
        // except in direct mode where the browser's is all there is.
        noiseSuppression: this.direct && this.opts.noise !== 'off',
        channelCount: 1,
        sampleRate: 48000,
      },
    });
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.inputGain);
    this.inputInUse = device;
    if (this.direct) {
      const old = this.directTrack;
      this.directTrack = stream.getAudioTracks()[0]!.clone();
      this.directTrack.enabled = this.open;
      for (const cb of this.sendListeners) cb(this.directTrack);
      old?.stop();
    }
    this.defaultName = device === 'default' ? await defaultDeviceName('audioinput') : '';
    // Unplugged (or the headset switched off): carry on with another mic.
    stream.getAudioTracks()[0]?.addEventListener('ended', () => void this.reopenAfterLoss(stream));
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
  }

  private async reopenAfterLoss(lost: MediaStream): Promise<void> {
    if (this.destroyed || lost !== this.stream) return;
    // Give the system a moment to settle on a new default device.
    await new Promise((r) => setTimeout(r, 500));
    if (this.destroyed || lost !== this.stream) return;
    await this.openDevice().catch(() => {
      // No mic at all right now; the next device change tries again.
    });
  }

  /** A device was plugged in or removed: back to the chosen mic and speakers if they returned. */
  private async devicesChanged(): Promise<void> {
    if (this.destroyed) return;
    const lost = !this.stream?.getAudioTracks().some((t) => t.readyState === 'live');
    const moved = (await pickDevice('audioinput', this.opts.deviceId)) !== this.inputInUse;
    // On "Default", follow the system's default mic like Windows does (a headset plugged in).
    const newDefault = this.inputInUse === 'default' && this.defaultName !== '' && (await defaultDeviceName('audioinput')) !== this.defaultName;
    if (lost || moved || newDefault) await this.openDevice().catch(() => {});
    await this.setOutputDevice(this.outputChoice);
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
    // Direct mode gates the sent mic itself (the voice library may also have touched it).
    if (this.directTrack && this.directTrack.enabled !== open) this.directTrack.enabled = open;
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
