// Stream quality levels, and the auto quality that steps between them.
// No browser APIs in here, so it can be unit-tested (test/quality.test.ts).

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

/** The 720p backup layer sent alongside 1080p and 1440p streams (Mbps). */
export const MIDDLE_LAYER_MBPS: Record<30 | 60, number> = { 30: 2, 60: 3 };

/**
 * Upload the streamer needs: the main stream, the 720p backup layer (for 1080p
 * and up), the small preview layer and some overhead.
 */
export function uploadNeeded(res: Resolution, fps: 30 | 60): number {
  const middle = res === '720p' ? 0 : MIDDLE_LAYER_MBPS[fps];
  return Math.ceil(BITRATES[res][fps] * 1.1 + middle + 1);
}

export type Tier = { res: Resolution; fps: 30 | 60; mbps: number };

export const tierLabel = (t: Tier) => `${t.res}${t.fps}`;

/**
 * Steps down from the chosen quality, never below 720p, keeping 60 fps. Only a
 * 720p stream goes on to 720p30: bigger streams also send a 720p backup layer,
 * which viewers fall back to if even 720p60 doesn't fit.
 */
export function ladder(res: Resolution, fps: 30 | 60): Tier[] {
  const order: [Resolution, 30 | 60][] =
    fps === 60
      ? [['1440p', 60], ['1080p', 60], ['720p', 60], ...(res === '720p' ? [['720p', 30] as [Resolution, 30]] : [])]
      : [['1440p', 30], ['1080p', 30], ['720p', 30]];
  const start = Math.max(0, order.findIndex(([r]) => r === res));
  return order.slice(start).map(([r, f]) => ({ res: r, fps: f, mbps: BITRATES[r][f] }));
}

/** One look at the outgoing stream, every couple of seconds. */
export type Sample = {
  /** What the browser says is holding the video back. */
  limitedBy: 'bandwidth' | 'cpu' | 'none';
  /** Upload the connection could carry right now (Mbps), 0 if unknown. */
  available: number;
};

export type Reason = 'upload' | 'pc';

const DOWN_AFTER = 3; // samples in a row that are held back
const UP_AFTER_KNOWN = 10; // clear samples with plenty of upload measured
const UP_AFTER_PROBE = 30; // clear samples when the upload isn't measured: try one step up
const PROBE_MAX = 150; // a failed try doubles the wait, up to about 5 minutes
const FAILED_PROBE_WITHIN = 10; // stepped back down this soon after trying: the try failed

/**
 * Decides when to step the stream down (held back by the upload or the PC for
 * a few seconds) and back up (clearly enough room for a while). Starts at the
 * chosen quality and never goes above it.
 */
export class AutoQuality {
  readonly tiers: Tier[];
  level = 0;
  reason: Reason | null = null;
  private held = 0;
  private clear = 0;
  private probeWait = UP_AFTER_PROBE;
  /** Samples since a step up that was a guess (not measured), or -1. */
  private sinceProbe = -1;

  constructor(tiers: Tier[]) {
    this.tiers = tiers;
  }

  get tier(): Tier {
    return this.tiers[this.level]!;
  }

  get lowered(): boolean {
    return this.level > 0;
  }

  /** Feeds one sample; returns true when the level changed. */
  next(s: Sample): boolean {
    if (this.sinceProbe >= 0) this.sinceProbe += 1;
    if (s.limitedBy !== 'none') {
      this.clear = 0;
      this.held += 1;
      if (this.held >= DOWN_AFTER && this.level < this.tiers.length - 1) {
        this.held = 0;
        this.level += 1;
        this.reason = s.limitedBy === 'cpu' ? 'pc' : 'upload';
        // Stepping straight back down after a guessed step up: wait longer before guessing again.
        if (this.sinceProbe >= 0 && this.sinceProbe <= FAILED_PROBE_WITHIN) this.probeWait = Math.min(this.probeWait * 2, PROBE_MAX);
        this.sinceProbe = -1;
        return true;
      }
      return false;
    }
    this.held = 0;
    if (this.level === 0) return false;
    this.clear += 1;
    const up = this.tiers[this.level - 1]!;
    const roomy = s.available > 0 && s.available >= up.mbps * 1.35;
    if ((roomy && this.clear >= UP_AFTER_KNOWN) || this.clear >= this.probeWait) {
      this.sinceProbe = roomy ? -1 : 0;
      if (roomy) this.probeWait = UP_AFTER_PROBE;
      this.clear = 0;
      this.level -= 1;
      if (this.level === 0) this.reason = null;
      return true;
    }
    return false;
  }
}
