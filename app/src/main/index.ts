import { app, BrowserWindow, ipcMain, net, powerMonitor, protocol, session, shell } from 'electron';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerCapture } from './capture';
import { registerGames } from './games';
import { registerPtt } from './ptt';
import { createTray } from './tray';
import { initUpdater } from './updater';

const here = fileURLToPath(new URL('.', import.meta.url));
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

// The app was first called Gamespeaker. Keep its data folder (sign-in, device id,
// settings) where it was, so renaming it doesn't sign anyone out.
app.setPath('userData', join(app.getPath('appData'), 'Gamespeaker'));

let win: BrowserWindow | null = null;
let quitting = false;

// What the window's close button does. Saved here too, because the main process
// needs it at startup (Start with your computer) before the app's settings load.
type CloseTo = 'taskbar' | 'tray' | 'quit';
const PREFS_FILE = join(app.getPath('userData'), 'window-prefs.json');
function readCloseTo(): CloseTo {
  try {
    const v = JSON.parse(readFileSync(PREFS_FILE, 'utf8')).closeTo;
    if (v === 'taskbar' || v === 'tray' || v === 'quit') return v;
  } catch {
    // first run
  }
  return 'taskbar';
}
let closeTo: CloseTo = readCloseTo();

// An update installed while the window was hidden or minimized (nobody looking)
// starts the new version the same way, instead of popping up over a game.
const RESTART_HIDDEN_FILE = join(app.getPath('userData'), 'restart-hidden');
function markRestartHidden(): void {
  try {
    writeFileSync(RESTART_HIDDEN_FILE, '');
  } catch {
    // not critical
  }
}
function takeRestartHidden(): boolean {
  try {
    const fresh = Date.now() - statSync(RESTART_HIDDEN_FILE).mtimeMs < 10 * 60 * 1000;
    rmSync(RESTART_HIDDEN_FILE, { force: true });
    return fresh;
  } catch {
    return false;
  }
}

// The UI is served from app://gamespeaker/ instead of file:// so fetch() works
// (noise suppression loads its WebAssembly that way) and the page has a stable,
// secure origin for its saved settings.
const RENDERER_DIR = join(here, '../renderer');
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function serveRenderer(): void {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = normalize(join(RENDERER_DIR, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(RENDERER_DIR + sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

if (isWin) app.setAppUserModelId('com.gamespeaker.app');

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0b0e',
    autoHideMenuBar: true,
    title: 'Gamecoms',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? false : { color: '#0a0b0e', symbolColor: '#a7adb8', height: 36 },
    icon: join(here, '../../build/icon.png'),
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Keep voice, timers and push-to-talk working while minimized or in the tray.
      backgroundThrottling: false,
      spellcheck: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  window.on('close', (event) => {
    if (quitting || closeTo === 'quit') return;
    // Keep running so friends can still reach you: minimized in the taskbar, or hidden in the tray.
    event.preventDefault();
    if (closeTo === 'tray') window.hide();
    else window.minimize();
  });

  // Stream pop-outs are same-origin blank windows the renderer fills in.
  // Everything else opens in the user's browser.
  window.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url === 'about:blank' && frameName.startsWith('gs-popout')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 760,
          backgroundColor: '#000000',
          autoHideMenuBar: true,
          title: 'Gamecoms stream',
        },
      };
    }
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  void window.loadURL(devUrl ?? 'app://gamespeaker/index.html');

  return window;
}

const ALLOWED_PERMISSIONS = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write']);

app.whenReady().then(() => {
  serveRenderer();
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));

  win = createWindow();
  const getWindow = () => win;

  registerCapture(getWindow);
  registerGames(getWindow);
  registerPtt(getWindow);
  const tray = createTray({ show: showWindow, quit: () => { quitting = true; app.quit(); }, getWindow });
  initUpdater(getWindow, () => {
    quitting = true;
    if (win && !win.isDestroyed() && (!win.isVisible() || win.isMinimized())) markRestartHidden();
  });

  ipcMain.on('app:version', (event) => {
    event.returnValue = app.getVersion();
  });
  ipcMain.handle('app:get-launch-at-login',() => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('app:set-launch-at-login', (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: ['--hidden'] });
  });
  ipcMain.handle('app:set-close-to', (_e, value: unknown) => {
    if (value !== 'taskbar' && value !== 'tray' && value !== 'quit') return;
    closeTo = value;
    try {
      writeFileSync(PREFS_FILE, JSON.stringify({ closeTo }));
    } catch {
      // not critical
    }
  });
  ipcMain.on('app:title-bar-color', (_e, color: string) => {
    if (!isMac && win && /^#[0-9a-f]{6}$/i.test(color)) win.setTitleBarOverlay({ color, symbolColor: '#a7adb8', height: 36 });
  });
  ipcMain.on('tray:state', (_e, state) => tray.setState(state));
  ipcMain.handle('app:idle-seconds', () => powerMonitor.getSystemIdleTime());
  ipcMain.on('app:show', () => showWindow());
  ipcMain.on('app:attention', () => {
    if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true);
  });
  win.on('focus', () => win?.flashFrame(false));

  // Started at login, or updated in the background: don't pop up over everything;
  // wait minimized in the taskbar (or in the tray).
  if (process.argv.includes('--hidden') || takeRestartHidden()) win.once('ready-to-show', () => (closeTo === 'tray' ? win?.hide() : win?.minimize()));

  app.on('activate', () => showWindow());
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
