import type { DetectedGame } from '../../../shared/bridge';
import { app, setApp } from '../state/store';
import { bridge } from './platform';
import { settings, updateSettings, useSettings } from './settings';
import { startStream } from './voice';

let started = false;

/**
 * Starts watching for a running game (Windows desktop app only). `onChange`
 * runs whenever the game or the "show what I'm playing" setting changes, so
 * presence can be re-sent.
 */
export function initGames(onChange: () => void): void {
  if (started || !bridge) return;
  started = true;
  const b = bridge;
  void b.gamesSupported().then(async (ok) => {
    if (!ok) return;
    setApp({ gamesSupported: true });
    b.onGameDetected((game) => {
      setApp({ game });
      onChange();
    });
    useSettings.subscribe((s, prev) => {
      if (s.detectGames !== prev.detectGames || s.ignoredGames !== prev.ignoredGames) void b.setGameDetection(s.detectGames, s.ignoredGames);
      if (s.showPlaying !== prev.showPlaying) onChange();
    });
    await b.setGameDetection(settings().detectGames, settings().ignoredGames);
    setApp({ game: await b.currentGame() });
    onChange();
  });
}

/** "Not a game": never suggest this program again. */
export function ignoreGame(game: DetectedGame): void {
  const s = settings();
  if (!s.ignoredGames.includes(game.exe)) updateSettings({ ignoredGames: [...s.ignoredGames, game.exe] });
  setApp({ game: null });
}

/** What friends see under your name, if you let them. */
export const playingNow = (): string | null => (settings().showPlaying ? (app().game?.name ?? null) : null);

/** One click: stream the game window with your saved quality and the game's own sound. */
export async function streamGame(game: DetectedGame): Promise<boolean> {
  const s = settings();
  const audio = Boolean(await bridge?.appAudioSupported());
  return startStream({ sourceId: game.sourceId, title: game.name, res: s.streamRes, fps: s.streamFps, mode: 'game', audio });
}
