import type { GamespeakerBridge } from '../../../shared/bridge';

declare global {
  interface Window {
    gamespeaker?: GamespeakerBridge;
  }
  const __SERVER_URL__: string;
}

/** Electron preload API, or null in the web build. */
export const bridge: GamespeakerBridge | null = window.gamespeaker ?? null;
export const isDesktop = bridge !== null;
export const isWindows = bridge?.platform === 'win32';
export const isMac = bridge?.platform === 'darwin' || /Mac/.test(navigator.platform);

/** Where the gateway lives. Desktop: baked in at build time. Web: the page's own origin. */
export function defaultServerUrl(): string {
  if (__SERVER_URL__) return __SERVER_URL__.replace(/\/+$/, '');
  if (!isDesktop) return location.origin;
  return 'http://localhost:8088';
}
