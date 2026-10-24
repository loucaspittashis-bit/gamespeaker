import type { CustomStatus, Status } from './gateway';
import { app, setApp } from '../state/store';
import { bridge } from './platform';
import { settings, useSettings } from './settings';

// Online / Idle / Do Not Disturb, custom status, and going idle by yourself.

const IDLE_AFTER_SEC = 10 * 60;
const CHECK_MS = 30_000;

/** What friends see: your choice, or Idle when "Online" and you've been away. */
export function currentStatus(): Status {
  const chosen = settings().status;
  if (chosen !== 'online') return chosen;
  return app().idle ? 'idle' : 'online';
}

export const isDnd = () => settings().status === 'dnd';

/** Your custom status, unless it has expired. */
export function currentCustom(): CustomStatus | null {
  const c = settings().customStatus;
  if (!c || (c.until !== null && c.until <= Date.now())) return null;
  return { emoji: c.emoji, text: c.text };
}

let started = false;

/** Watches for being away and for the custom status running out; `onChange` re-sends presence. */
export function initStatus(onChange: () => void): void {
  if (started) return;
  started = true;
  let lastInput = Date.now();
  if (!bridge) {
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const) {
      window.addEventListener(ev, () => (lastInput = Date.now()), { passive: true });
    }
  }
  const check = async () => {
    const away = bridge ? await bridge.getIdleSeconds().catch(() => 0) : (Date.now() - lastInput) / 1000;
    // Never idle while in voice: you're clearly around.
    const idle = away >= IDLE_AFTER_SEC && !app().voiceChannel;
    if (idle !== app().idle) setApp({ idle });
    const c = settings().customStatus;
    if (c?.until && c.until <= Date.now()) useSettings.getState().set({ customStatus: null });
    onChange();
  };
  window.setInterval(() => void check(), CHECK_MS);
  useSettings.subscribe((s, prev) => {
    if (s.status !== prev.status || s.customStatus !== prev.customStatus) onChange();
  });
}
