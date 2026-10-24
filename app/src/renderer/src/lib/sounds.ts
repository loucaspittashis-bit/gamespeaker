// Small UI sounds, synthesized on the fly (no audio files to license).

type Note = { freq: number; at: number; dur: number; gain?: number };

let ctx: AudioContext | null = null;

function play(notes: Note[], type: OscillatorType = 'sine'): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = n.freq;
      const peak = n.gain ?? 0.12;
      gain.gain.setValueAtTime(0, t0 + n.at);
      gain.gain.linearRampToValueAtTime(peak, t0 + n.at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.dur + 0.05);
    }
  } catch {
    // Audio not available; sounds are optional.
  }
}

export const sounds = {
  /** Someone (or you) joined the voice channel: a bright rising pair. */
  join: () => play([{ freq: 660, at: 0, dur: 0.14 }, { freq: 990, at: 0.09, dur: 0.22 }], 'triangle'),
  /** Someone left: the same pair, falling. */
  leave: () => play([{ freq: 880, at: 0, dur: 0.14 }, { freq: 523, at: 0.09, dur: 0.22 }], 'triangle'),
  mute: () => play([{ freq: 520, at: 0, dur: 0.08, gain: 0.08 }]),
  unmute: () => play([{ freq: 740, at: 0, dur: 0.08, gain: 0.08 }]),
  streamStart: () =>
    play([
      { freq: 523, at: 0, dur: 0.12 },
      { freq: 784, at: 0.08, dur: 0.12 },
      { freq: 1047, at: 0.16, dur: 0.24 },
    ], 'triangle'),
  streamStop: () => play([{ freq: 784, at: 0, dur: 0.12 }, { freq: 392, at: 0.08, dur: 0.22 }], 'triangle'),
  message: () => play([{ freq: 1175, at: 0, dur: 0.09, gain: 0.05 }]),
};
