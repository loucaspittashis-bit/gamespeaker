import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell, systemPreferences } from 'electron';
import { nodeRequire } from './native';
import { win32 } from './win32';
import type { AppAudioStatus, CaptureListResult, CaptureSource } from '../shared/bridge';

const SCREEN_PERMISSION_HELP =
  'macOS needs permission before Gamecoms can share your screen. Turn it on in System Settings → ' +
  'Privacy & Security → Screen & System Audio Recording, then quit and reopen Gamecoms.';

// Optional Windows-only native modules. They aren't installed on other platforms.
type LoopbackCapture = {
  start(pid: number, includeTree: boolean, cb: (chunk: Buffer) => void): void;
  stop(): void;
};
let loopbackModule: { LoopbackCapture: new () => LoopbackCapture } | null = null;

if (process.platform === 'win32') {
  try {
    loopbackModule = nodeRequire('loopback-capture');
  } catch (err) {
    console.warn('per-app audio unavailable:', err);
  }
}

// Window classes that are part of Windows itself, never worth streaming.
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow', 'NotifyIconOverflowWindow']);

/**
 * Windows' capture list leaves out some real app windows (the Battle.net
 * launcher, for one). Find visible windows it skipped so they can still be
 * picked. There's no preview for these, so they show the program's icon.
 */
async function windowsItMissed(listed: Set<number>): Promise<CaptureSource[]> {
  if (!win32) return [];
  const out: CaptureSource[] = [];
  try {
    for (const w of win32.topWindows()) {
      if (listed.has(w.hwnd) || w.pid === process.pid || w.minimized || w.cloaked) continue;
      if (w.width < 200 || w.height < 150 || SHELL_CLASSES.has(w.className)) continue;
      // See-through overlays drawn over the whole screen (NVIDIA, Game Bar) aren't windows to share.
      if (w.overlay && win32.isFullscreen(w.hwnd)) continue;
      const exePath = win32.exePathOf(w.pid);
      const icon = exePath ? await app.getFileIcon(exePath, { size: 'large' }).catch(() => null) : null;
      out.push({
        id: `window:${w.hwnd}:0`,
        name: w.title,
        kind: 'window',
        thumbnail: '',
        appIcon: icon && !icon.isEmpty() ? icon.toDataURL() : null,
        preview: false,
      });
    }
  } catch (err) {
    console.warn('could not list extra windows:', err);
  }
  return out;
}

let selectedSourceId: string | null = null;
let capture: LoopbackCapture | null = null;

function stopAppAudio(): void {
  try {
    capture?.stop();
  } catch {
    // already stopped
  }
  capture = null;
}

export function registerCapture(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('capture:list', async (): Promise<CaptureListResult> => {
    const isMac = process.platform === 'darwin';
    try {
      // On macOS the first call also makes the system ask for Screen Recording permission.
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 480, height: 270 },
        fetchWindowIcons: true,
      });
      if (isMac && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
        return { ok: false, reason: 'permission', message: SCREEN_PERMISSION_HELP };
      }
      // Never offer our own windows (the app, popped-out streams).
      const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()));
      const listed: CaptureSource[] = sources
        .filter((s) => s.name && !own.has(s.id))
        .map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.id.startsWith('screen:') ? ('screen' as const) : ('window' as const),
          thumbnail: s.thumbnail.toDataURL(),
          appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
        }));
      const hwnds = new Set(sources.map((s) => Number(/^window:(\d+):/.exec(s.id)?.[1] ?? 0)));
      return { ok: true, sources: [...listed, ...(await windowsItMissed(hwnds))] };
    } catch (err) {
      if (isMac && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
        return { ok: false, reason: 'permission', message: SCREEN_PERMISSION_HELP };
      }
      return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('capture:open-permission-settings', async () => {
    if (process.platform === 'darwin') {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    }
  });

  ipcMain.handle('capture:select', (_e, id: string) => {
    selectedSourceId = typeof id === 'string' ? id : null;
  });

  // getDisplayMedia in the renderer lands here: hand back the source picked in our
  // own Go Live picker instead of showing a system dialog. Sound is captured
  // separately per app (below), so friends never hear voice chat echoed back.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
      const id = selectedSourceId;
      selectedSourceId = null;
      const source = sources.find((s) => s.id === id) ?? null;
      if (source) callback({ video: source });
      // A window Windows' list skipped: capture it directly by its handle.
      else if (id && /^window:\d+:/.test(id)) callback({ video: { id, name: 'Window' } });
      else callback({});
    },
    { useSystemPicker: false },
  );

  ipcMain.handle('capture:app-audio-supported', () => Boolean(loopbackModule));

  ipcMain.handle('capture:start-app-audio', (_e, sourceId: string): AppAudioStatus => {
    stopAppAudio();
    if (!loopbackModule) return { ok: false, reason: 'Stream sound needs Windows 10 (2004) or newer.' };

    let pid: number;
    let includeTree: boolean;
    const windowMatch = /^window:(\d+):/.exec(sourceId);
    if (windowMatch) {
      // A window: capture only that program (and its child processes).
      pid = win32?.pidOf(Number(windowMatch[1])) ?? 0;
      includeTree = true;
      if (!pid) return { ok: false, reason: 'Could not find the program behind that window.' };
    } else {
      // A whole screen: capture everything except this app itself, so voice chat isn't included.
      pid = process.pid;
      includeTree = false;
    }

    try {
      capture = new loopbackModule.LoopbackCapture();
      capture.start(pid, includeTree, (chunk) => {
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('capture:app-audio', chunk);
      });
      return { ok: true };
    } catch (err) {
      capture = null;
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('capture:stop-app-audio', () => stopAppAudio());
}
