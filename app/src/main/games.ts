import { BrowserWindow, desktopCapturer, ipcMain } from 'electron';
import { basename } from 'node:path';
import { nodeRequire } from './native';
import { pickGame, type DetectedGame, type WindowInfo } from '../shared/games';

// Watches for a running game (Windows only) so the app can offer one-click
// streaming and show "Playing …". Every few seconds: list the open windows,
// look up the program behind each one, and check which cover their monitor.

const POLL_MS = 4000;

type Win32 = {
  pidOf(hwnd: number): number;
  exeOf(pid: number): string;
  isFullscreen(hwnd: number): boolean;
  /** Click-through, tool or never-focusable: how overlays mark their windows. */
  isOverlay(hwnd: number): boolean;
  foreground(): number;
};

function loadWin32(): Win32 | null {
  if (process.platform !== 'win32') return null;
  try {
    const koffi = nodeRequire('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const RECT = koffi.struct('GS_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
    const MONITORINFO = koffi.struct('GS_MONITORINFO', { cbSize: 'uint32_t', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32_t' });

    const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hWnd, _Out_ uint32_t *lpdwProcessId)');
    const GetForegroundWindow = user32.func('uintptr_t __stdcall GetForegroundWindow()');
    const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hWnd, int nIndex)');
    const GWL_EXSTYLE = -20;
    const WS_EX_TRANSPARENT = 0x20;
    const WS_EX_TOOLWINDOW = 0x80;
    const WS_EX_NOACTIVATE = 0x08000000;
    const IsIconic = user32.func('bool __stdcall IsIconic(uintptr_t hWnd)');
    const GetWindowRect = user32.func('bool __stdcall GetWindowRect(uintptr_t hWnd, _Out_ GS_RECT *lpRect)');
    const MonitorFromWindow = user32.func('uintptr_t __stdcall MonitorFromWindow(uintptr_t hwnd, uint32_t dwFlags)');
    const GetMonitorInfoW = user32.func('bool __stdcall GetMonitorInfoW(uintptr_t hMonitor, _Inout_ GS_MONITORINFO *lpmi)');
    const OpenProcess = kernel32.func('void * __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)');
    const QueryFullProcessImageNameW = kernel32.func(
      'bool __stdcall QueryFullProcessImageNameW(void *hProcess, uint32_t dwFlags, _Out_ uint16_t *lpExeName, _Inout_ uint32_t *lpdwSize)',
    );
    const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *hObject)');
    const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const MONITOR_DEFAULTTONEAREST = 2;
    const monitorInfoSize = koffi.sizeof(MONITORINFO);
    const emptyRect = { left: 0, top: 0, right: 0, bottom: 0 };

    return {
      pidOf: (hwnd) => {
        const out = [0];
        GetWindowThreadProcessId(hwnd, out);
        return out[0] ?? 0;
      },
      exeOf: (pid) => {
        const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (!handle) return '';
        try {
          const buf = new Uint16Array(1024);
          const size = [buf.length];
          if (!QueryFullProcessImageNameW(handle, 0, buf, size)) return '';
          return basename(String.fromCharCode(...buf.subarray(0, size[0]))).toLowerCase();
        } finally {
          CloseHandle(handle);
        }
      },
      isFullscreen: (hwnd) => {
        if (IsIconic(hwnd)) return false;
        const rect = { ...emptyRect };
        if (!GetWindowRect(hwnd, rect)) return false;
        const info = { cbSize: monitorInfoSize, rcMonitor: { ...emptyRect }, rcWork: { ...emptyRect }, dwFlags: 0 };
        if (!GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), info)) return false;
        const m = info.rcMonitor;
        return rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom;
      },
      isOverlay: (hwnd) => {
        const ex = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
        return (ex & (WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE)) !== 0;
      },
      foreground: () => Number(GetForegroundWindow()),
    };
  } catch (err) {
    console.warn('game detection unavailable:', err);
    return null;
  }
}

export function registerGames(getWindow: () => BrowserWindow | null): void {
  const win32 = loadWin32();
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
