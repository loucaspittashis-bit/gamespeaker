import type { DetectedGame } from '../../../shared/bridge';
import { app, setApp } from '../state/store';
import { bridge } from './platform';
import { settings, useSettings } from './settings';
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
      if (s.detectGames !== prev.detectGames) void b.setGameDetection(s.detectGames);
      if (s.showPlaying !== prev.showPlaying) onChange();
    });
    await b.setGameDetection(settings().detectGames);
    setApp({ game: await b.currentGame() });
    onChange();
  });
}

/** What friends see under your name, if you let them. */
export const playingNow = (): string | null => (settings().showPlaying ? (app().game?.name ?? null) : null);

/** One click: stream the game window with your saved quality and the game's own sound. */
export async function streamGame(game: DetectedGame): Promise<boolean> {
  const s = settings();
  const audio = Boolean(await bridge?.appAudioSupported());
  return startStream({ sourceId: game.sourceId, title: game.name, res: s.streamRes, fps: s.streamFps, mode: 'game', audio });
}
