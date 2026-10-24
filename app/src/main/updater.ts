import { app, ipcMain, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateStatus } from '../shared/bridge';

const { autoUpdater } = electronUpdater;
const CHECK_EVERY_MS = 30 * 60 * 1000;
/** Bringing the window up checks again if the last check was this long ago. */
const RECHECK_ON_FOCUS_MS = 10 * 60 * 1000;

// Downloads new versions from GitHub Releases in the background and installs
// them on the next restart (or right away when the user clicks "Restart").
export function initUpdater(getWindow: () => BrowserWindow | null, beforeInstall: () => void): void {
  const send = (status: UpdateStatus) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update:status', status);
  };

  ipcMain.handle('update:install', () => {
    beforeInstall();
    autoUpdater.quitAndInstall(true, true);
  });

  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => send({ state: 'idle' }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', version: '', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => send({ state: 'error', message: err?.message ?? 'Update failed' }));

  let lastCheck = 0;
  let downloaded = false;
  autoUpdater.on('update-downloaded', () => (downloaded = true));
  const check = () => {
    if (downloaded) return; // already waiting for a restart
    lastCheck = Date.now();
    void autoUpdater.checkForUpdates().catch(() => {});
  };
  setTimeout(check, 10_000);
  setInterval(check, CHECK_EVERY_MS);
  app.on('browser-window-focus', () => {
    if (Date.now() - lastCheck > RECHECK_ON_FOCUS_MS) check();
  });
  ipcMain.handle('update:check', () => check());
}
