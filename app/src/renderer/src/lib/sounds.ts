// Small UI sounds, synthesized on the fly (no audio files to license).
// Kept deliberately soft and low: sine tones around middle C, quiet, with a
// gentle fade and a low-pass filter so nothing ends in a sharp click.

import { settings } from './settings';

type Note = { freq: number; at: number; dur: number; gain?: number };

let ctx: AudioContext | null = null;
let out: AudioNode | null = null;

function output(c: AudioContext): AudioNode {
  if (out) return out;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1200;
  filter.Q.value = 0.5;
  filter.connect(c.destination);
  out = filter;
  return out;
}

function play(notes: Note[]): void {
  if (!settings().soundEffects) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const dest = output(ctx);
    const t0 = ctx.currentTime + 0.02;
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      // A quiet octave on top keeps low notes audible on laptop speakers.
      const overtone = ctx.createOscillator();
      overtone.type = 'sine';
      overtone.frequency.value = n.freq * 2;
      const overtoneGain = ctx.createGain();
      overtoneGain.gain.value = 0.25;
      const start = t0 + n.at;
      const peak = n.gain ?? 0.07;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.03);
      // Smooth exponential fade that reaches silence well before the oscillator stops.
      gain.gain.setTargetAtTime(0, start + 0.035, n.dur / 5);
      osc.connect(gain).connect(dest);
      overtone.connect(overtoneGain).connect(gain);
      for (const o of [osc, overtone]) {
        o.start(start);
        o.stop(start + n.dur + 0.15);
      }
    }
  } catch {
    // Audio not available; sounds are optional.
  }
}

// Notes: G3 196 Hz, C4 262 Hz, E4 330 Hz, G4 392 Hz.
export const sounds = {
  /** Someone (or you) joined the voice channel: a soft rising pair. */
  join: () => play([{ freq: 262, at: 0, dur: 0.24 }, { freq: 330, at: 0.11, dur: 0.32 }]),
  /** Someone left: the same pair, falling. */
  leave: () => play([{ freq: 330, at: 0, dur: 0.24 }, { freq: 262, at: 0.11, dur: 0.32 }]),
  mute: () => play([{ freq: 196, at: 0, dur: 0.14, gain: 0.05 }]),
  unmute: () => play([{ freq: 262, at: 0, dur: 0.14, gain: 0.05 }]),
  /** Someone went live in your channel: three soft rising notes. */
  streamStart: () =>
    play([
      { freq: 262, at: 0, dur: 0.22, gain: 0.065 },
      { freq: 330, at: 0.1, dur: 0.22, gain: 0.065 },
      { freq: 392, at: 0.2, dur: 0.34, gain: 0.065 },
    ]),
  /** A stream ended: two soft falling notes. */
  streamStop: () => play([{ freq: 392, at: 0, dur: 0.22, gain: 0.065 }, { freq: 262, at: 0.11, dur: 0.34, gain: 0.065 }]),
  message: () => play([{ freq: 330, at: 0, dur: 0.14, gain: 0.035 }]),
};
