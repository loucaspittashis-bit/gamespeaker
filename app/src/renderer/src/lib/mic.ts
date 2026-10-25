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
//   mic -> rumble filter -> input volume -> noise suppression (RNNoise / GTCRN / none)
//       -> level meter -> 50 ms delay -> limiter -> gate (voice activity or push-to-talk)
//       -> the track sent to LiveKit
//
// The rumble filter drops what's under the voice (mains hum, desk knocks, fans,
// breath pops). The delay lets the gate wait to be sure it's speech (not a
// click) and still open in time for the first syllable. The limiter keeps
// shouting from crackling. A meter on the raw mic notices when the mic itself
// is set so loud that it distorts.
//
// The published track never changes; switching mics or noise settings rewires
// the nodes in front of it, so nobody hears a reconnect.
//
// When the PC is too busy for this chain to keep up (a game using every core),
// the voice it sends breaks up and buzzes. Then goDirect() sends the mic as
// the system captures it instead, with the browser's own noise suppression.
// The chain above keeps running (with our suppressor) only to decide when
// you're speaking, so room sounds still don't open the mic.

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

const TICK_MS = 20;
/** Voice activity: stays open this long after the last speech, so pauses between words don't cut. */
const VA_HOLD_MS = 300;
/** Longer in direct mode, where the level reaches us late when the PC is busy. */
const VA_HOLD_DIRECT_MS = 450;
/** Loud ticks in a row needed to open (60 ms): clicks, taps and knocks are shorter. */
const VA_ATTACK_TICKS = 3;
/** The sent audio runs this far behind the level meter, so waiting for the attack doesn't clip words. */
const LOOKAHEAD_S = 0.05;
/** Below the lowest voices (about 85 Hz for deep ones). */
const RUMBLE_HZ = 80;
/** Raw samples this close to full scale mean the mic is distorting. */
const CLIP_LEVEL = 0.99;
/** Ticks with clipping (about half a second of it) within CLIP_WINDOW_MS before saying so: a too-loud mic clips all through normal speech, a single laugh doesn't count. */
const CLIP_TICKS = 25;
const CLIP_WINDOW_MS = 10_000;
/** Once open, quieter speech (this many dB under the line) keeps it open... */
const VA_HYSTERESIS_DB = 6;
/** ...as long as it lasts this many ticks in a row and is voice-like (typing after you stop talking doesn't). */
const VA_SUSTAIN_TICKS = 2;
/**
 * Voice is loudest below ~1 kHz; clicks, taps and rustling spread across all
 * frequencies. To open, the 100-900 Hz band must beat 2-8 kHz by this much.
 */
const VOICE_TILT_DB = 6;
/** How fast the noise floor estimate may rise, per tick (about 1.7 dB a second). */
const FLOOR_RISE_PER_TICK = (1.7 * TICK_MS) / 1000;

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
  private rumble: BiquadFilterNode[];
  private rawMeter: AnalyserNode;
  private rawSamples: Float32Array<ArrayBuffer>;
  private clipTimes: number[] = [];
  private clipReported = false;
  private clipListeners = new Set<() => void>();
  private lookahead: DelayNode;
  private limiter: DynamicsCompressorNode;
  private gate: GainNode;
  private monitor: GainNode;
  private dest: MediaStreamAudioDestinationNode;
  private samples: Float32Array<ArrayBuffer>;
  private spectrum: Float32Array<ArrayBuffer>;
  private timer: number | null = null;
  private muted = false;
  private pttPressed = false;
  private pttReleasedAt = 0;
  private lastVoiceAt = 0;
  private loudTicks = 0;
  private warmTicks = 0;
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
    // Two stages: steep enough to take 50 Hz mains hum down ~16 dB, gentle on deep voices.
    this.rumble = [0, 1].map(() => {
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = RUMBLE_HZ;
      f.Q.value = Math.SQRT1_2;
      return f;
    });
    this.rumble[0]!.connect(this.rumble[1]!);
    this.rawMeter = ctx.createAnalyser();
    this.rawMeter.fftSize = 1024;
    this.rawSamples = new Float32Array(this.rawMeter.fftSize);
    this.inputGain = ctx.createGain();
    this.rumble[1]!.connect(this.inputGain);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0;
    this.samples = new Float32Array(this.analyser.fftSize);
    this.spectrum = new Float32Array(this.analyser.frequencyBinCount);
    this.lookahead = ctx.createDelay(0.2);
    this.lookahead.delayTime.value = LOOKAHEAD_S;
    // Just under full scale, hard and fast: only the loudest peaks are touched.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.1;
    this.gate = ctx.createGain();
    this.gate.gain.value = 0;
    this.monitor = ctx.createGain();
    this.monitor.gain.value = 0;
    this.dest = ctx.createMediaStreamDestination();
    this.dest.channelCount = 1;
    this.analyser.connect(this.lookahead);
    this.lookahead.connect(this.limiter);
    this.limiter.connect(this.gate);
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

  /** Called once if the mic itself distorts (set too loud in Windows, or a hot mic). */
  onClipping(cb: () => void): () => void {
    this.clipListeners.add(cb);
    return () => this.clipListeners.delete(cb);
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
    await this.openDevice();
  }

  /** Back to sending the processed mic (full noise suppression). */
  async goProcessed(): Promise<void> {
    if (!this.direct || this.destroyed) return;
    this.direct = false;
    await this.openDevice();
    const old = this.directTrack;
    this.directTrack = null;
    for (const cb of this.sendListeners) cb(this.track);
    old?.stop();
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
    this.clipListeners.clear();
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
    this.source.connect(this.rumble[0]!);
    this.source.connect(this.rawMeter);
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

  /** Counts moments where the raw mic hits full scale while you speak; says so once if it keeps happening. */
  private checkClipping(now: number): void {
    if (this.clipReported) return;
    this.rawMeter.getFloatTimeDomainData(this.rawSamples);
    let clipped = 0;
    for (let i = 0; i < this.rawSamples.length; i++) if (Math.abs(this.rawSamples[i]!) >= CLIP_LEVEL) clipped++;
    if (clipped < 3) return;
    this.clipTimes = [...this.clipTimes.filter((t) => now - t < CLIP_WINDOW_MS), now];
    if (this.clipTimes.length < CLIP_TICKS) return;
    this.clipReported = true;
    for (const cb of this.clipListeners) cb();
  }

  /** Whether the last few milliseconds sound like a voice rather than a click (see VOICE_TILT_DB). */
  private voiceLike(): boolean {
    this.analyser.getFloatFrequencyData(this.spectrum);
    const hz = this.ctx.sampleRate / this.analyser.fftSize;
    const band = (from: number, to: number) => {
      let power = 0;
      for (let i = Math.round(from / hz); i <= Math.round(to / hz) && i < this.spectrum.length; i++) power += 10 ** (this.spectrum[i]! / 10);
      return power;
    };
    return 10 * Math.log10((band(100, 900) + 1e-12) / (band(2000, 8000) + 1e-12)) > VOICE_TILT_DB;
  }

  private tick(): void {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) sum += this.samples[i]! * this.samples[i]!;
    const db = Math.max(-100, 20 * Math.log10(Math.sqrt(sum / this.samples.length) + 1e-9));
    const now = performance.now();

    // Track the room's background level for automatic sensitivity: fall fast, rise slowly.
    this.noiseFloor = db < this.noiseFloor ? db : this.noiseFloor + FLOOR_RISE_PER_TICK;

    const threshold = this.threshold;
    let open: boolean;
    if (this.muted) {
      open = false;
    } else if (this.opts.mode === 'ptt') {
      open = this.pttPressed || now - this.pttReleasedAt < this.opts.pttRelease;
    } else {
      // Open on voice-like sound that lasts, ignore clicks, and ride through quieter syllables.
      // (Consonants like "s" aren't voice-like, but the hold rides through them.)
      const voice = this.voiceLike();
      this.loudTicks = db > threshold && voice ? this.loudTicks + 1 : 0;
      this.warmTicks = db > threshold - VA_HYSTERESIS_DB && voice ? this.warmTicks + 1 : 0;
      if (this.loudTicks >= VA_ATTACK_TICKS || (this.open && this.warmTicks >= VA_SUSTAIN_TICKS)) this.lastVoiceAt = now;
      open = now - this.lastVoiceAt < (this.direct ? VA_HOLD_DIRECT_MS : VA_HOLD_MS);
    }

    if (open !== this.open) {
      this.open = open;
      this.gate.gain.setTargetAtTime(open ? 1 : 0, this.ctx.currentTime, open ? 0.005 : 0.03);
    }
    // Direct mode gates the sent mic itself (the voice library may also have touched it).
    if (this.directTrack && this.directTrack.enabled !== open) this.directTrack.enabled = open;
    if (open) this.checkClipping(now);
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
