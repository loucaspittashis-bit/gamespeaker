import { BrowserWindow, desktopCapturer, ipcMain } from 'electron';
import { win32 } from './win32';
import { pickGame, type DetectedGame, type WindowInfo } from '../shared/games';

// Watches for a running game (Windows only) so the app can offer one-click
// streaming and show "Playing …". Every few seconds: list the open windows,
// look up the program behind each one, and check which cover their monitor.

const POLL_MS = 4000;

export function registerGames(getWindow: () => BrowserWindow | null): void {
  const exeCache = new Map<number, string>(); // pid -> program name
  // Fullscreen windows you've been in. Overlays cover the screen too, but never get focus.
  const played = new Set<string>();
  let ignored = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let last: DetectedGame | null = null;
  let busy = false;

  const send = (game: DetectedGame | null) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send('games:detected', game);
  };

  const scan = async () => {
    if (!win32 || busy) return;
    busy = true;
    try {
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
      const own = new Set(
        BrowserWindow.getAllWindows().map((w) => {
          const h = w.getNativeWindowHandle();
          return h.length >= 8 ? Number(h.readBigUInt64LE(0)) : h.readUInt32LE(0);
        }),
      );
      const foreground = win32.foreground();
      const pids = new Set<number>();
      const open = new Set<string>();
      const windows: WindowInfo[] = [];
      for (const s of sources) {
        const hwnd = Number(/^window:(\d+):/.exec(s.id)?.[1] ?? 0);
        if (!hwnd || own.has(hwnd)) continue;
        const pid = win32.pidOf(hwnd);
        if (!pid || pid === process.pid) continue;
        pids.add(pid);
        let exe = exeCache.get(pid);
        if (exe === undefined) {
          exe = win32.exeOf(pid);
          exeCache.set(pid, exe);
        }
        open.add(s.id);
        if (ignored.has(exe)) continue;
        const fullscreen = win32.isFullscreen(hwnd);
        const focused = hwnd === foreground;
        if (fullscreen && focused) played.add(s.id);
        windows.push({ sourceId: s.id, title: s.name, exe, fullscreen, focused, played: played.has(s.id), overlay: win32.isOverlay(hwnd) });
      }
      for (const pid of exeCache.keys()) if (!pids.has(pid)) exeCache.delete(pid);
      for (const id of played) if (!open.has(id)) played.delete(id);

      const game = pickGame(windows);
      // Only tell the app when the game changes, not on every scan.
      if (game?.sourceId !== last?.sourceId || game?.name !== last?.name) {
        last = game;
        send(game);
      }
    } catch (err) {
      console.warn('game scan failed:', err);
    } finally {
      busy = false;
    }
  };

  ipcMain.handle('games:supported', () => Boolean(win32));
  ipcMain.handle('games:set-enabled', (_e, enabled: boolean, ignoredExes: unknown) => {
    // Programs the user marked "Not a game".
    ignored = new Set(Array.isArray(ignoredExes) ? ignoredExes.filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase()) : []);
    if (timer) clearInterval(timer);
    timer = null;
    if (enabled && win32) {
      timer = setInterval(() => void scan(), POLL_MS);
      void scan();
    } else if (last) {
      last = null;
      send(null);
    }
  });
  // A reload of the window forgets what it was told; tell it again.
  ipcMain.handle('games:current', () => last);
}
