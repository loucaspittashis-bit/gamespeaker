import type { Glow } from './settings';

export const NEON_PRESETS = [
  { name: 'Cyan', hex: '#2de2ff' },
  { name: 'Magenta', hex: '#ff4fd8' },
  { name: 'Lime', hex: '#b6ff3b' },
  { name: 'Violet', hex: '#a78bff' },
  { name: 'Amber', hex: '#ffb02e' },
  { name: 'Mint', hex: '#4dffc3' },
] as const;

export function neonName(hex: string): string {
  return NEON_PRESETS.find((p) => p.hex.toLowerCase() === hex.toLowerCase())?.name ?? 'Custom';
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n) || h.length !== 6) return [45, 226, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Everything neon in the CSS reads --neon / --neon-rgb, and glow strength comes from data-glow. */
export function applyTheme(neon: string, glow: Glow): void {
  const root = document.documentElement;
  root.style.setProperty('--neon', neon);
  root.style.setProperty('--neon-rgb', hexToRgb(neon).join(', '));
  root.dataset.glow = glow;
}
