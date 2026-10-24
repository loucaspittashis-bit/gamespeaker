import { desktopCapturer, ipcMain, session, shell, systemPreferences, type BrowserWindow } from 'electron';
import { nodeRequire } from './native';
import type { AppAudioStatus, CaptureListResult } from '../shared/bridge';

const SCREEN_PERMISSION_HELP =
  'macOS needs permission before Gamespeaker can share your screen. Turn it on in System Settings → ' +
  'Privacy & Security → Screen & System Audio Recording, then quit and reopen Gamespeaker.';

// Optional Windows-only native modules. They aren't installed on other platforms.
type LoopbackCapture = {
  start(pid: number, includeTree: boolean, cb: (chunk: Buffer) => void): void;
  stop(): void;
};
let loopbackModule: { LoopbackCapture: new () => LoopbackCapture } | null = null;
let getWindowPid: ((hwnd: number) => number) | null = null;

if (process.platform === 'win32') {
  try {
    loopbackModule = nodeRequire('loopback-capture');
  } catch (err) {
    console.warn('per-app audio unavailable:', err);
  }
  try {
    const koffi = nodeRequire('koffi');
    const user32 = koffi.load('user32.dll');
    const fn = user32.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hWnd, _Out_ uint32_t *lpdwProcessId)');
    getWindowPid = (hwnd: number) => {
      const out = [0];
      fn(hwnd, out);
      return out[0] ?? 0;
    };
  } catch (err) {
    console.warn('window -> process lookup unavailable:', err);
  }
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
      const ownTitle = getWindow()?.getTitle();
      return {
        ok: true,
        sources: sources
          .filter((s) => s.name && s.name !== ownTitle && !s.name.startsWith('Gamespeaker stream'))
          .map((s) => ({
            id: s.id,
            name: s.name,
            kind: s.id.startsWith('screen:') ? ('screen' as const) : ('window' as const),
            thumbnail: s.thumbnail.toDataURL(),
            appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
          })),
      };
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
      const source = sources.find((s) => s.id === selectedSourceId) ?? null;
      selectedSourceId = null;
      if (!source) {
        callback({});
        return;
      }
      callback({ video: source });
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
      pid = getWindowPid?.(Number(windowMatch[1])) ?? 0;
      includeTree = true;
      if (!pid) return { ok: false, reason: 'Could not find the program behind that window.' };
    } else {
      // A whole screen: capture everything except Gamespeaker itself, so voice chat isn't included.
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
