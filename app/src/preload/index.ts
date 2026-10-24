import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { GamespeakerBridge } from '../shared/bridge';

function listen<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const bridge: GamespeakerBridge = {
  platform: process.platform as GamespeakerBridge['platform'],
  version: String(ipcRenderer.sendSync('app:version') ?? ''),

  listCaptureSources: () => ipcRenderer.invoke('capture:list'),
  openScreenPermissionSettings: () => ipcRenderer.invoke('capture:open-permission-settings'),
  selectCaptureSource: (id) => ipcRenderer.invoke('capture:select', id),

  appAudioSupported: () => ipcRenderer.invoke('capture:app-audio-supported'),
  startAppAudio: (sourceId) => ipcRenderer.invoke('capture:start-app-audio', sourceId),
  stopAppAudio: () => ipcRenderer.invoke('capture:stop-app-audio'),
  onAppAudio: (cb) =>
    listen<Uint8Array>('capture:app-audio', (chunk) => {
      cb(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
    }),

  gamesSupported: () => ipcRenderer.invoke('games:supported'),
  setGameDetection: (enabled, ignored) => ipcRenderer.invoke('games:set-enabled', enabled, ignored),
  currentGame: () => ipcRenderer.invoke('games:current'),
  onGameDetected: (cb) => listen('games:detected', cb),

  setPttBinding: (binding) => ipcRenderer.invoke('ptt:set-binding', binding),
  onPtt: (cb) => listen<boolean>('ptt', cb),
  recordPttBinding: () => ipcRenderer.invoke('ptt:record'),

  onUpdateStatus: (cb) => listen('update:status', cb),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),

  setTrayState: (state) => ipcRenderer.send('tray:state', state),
  onTrayAction: (cb) => listen('tray:action', cb),

  getIdleSeconds: () => ipcRenderer.invoke('app:idle-seconds'),
  showWindow: () => ipcRenderer.send('app:show'),
  requestAttention: () => ipcRenderer.send('app:attention'),

  getLaunchAtLogin: () => ipcRenderer.invoke('app:get-launch-at-login'),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('app:set-launch-at-login', enabled),
  setCloseTo: (value) => ipcRenderer.invoke('app:set-close-to', value),
  setTitleBarColor: (color) => ipcRenderer.send('app:title-bar-color', color),
};

contextBridge.exposeInMainWorld('gamespeaker', bridge);
