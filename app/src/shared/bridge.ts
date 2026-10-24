// The API the Electron preload exposes as `window.gamespeaker`.
// In the web build it doesn't exist and the app falls back to browser features.

import type { DetectedGame } from './games';
export type { DetectedGame };

export type CaptureSource = {
  id: string;
  name: string;
  kind: 'window' | 'screen';
  thumbnail: string; // data URL
  appIcon: string | null; // data URL
};

export type CaptureListResult =
  | { ok: true; sources: CaptureSource[] }
  | { ok: false; reason: 'permission' | 'error'; message: string };

export type PttBinding =
  | { kind: 'key'; code: number; label: string }
  | { kind: 'mouse'; button: number; label: string };

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

export type AppAudioStatus = { ok: true } | { ok: false; reason: string };

export interface GamespeakerBridge {
  platform: 'win32' | 'darwin' | 'linux';
  version: string;

  /** Windows and screens for the Go Live picker, with thumbnails. */
  listCaptureSources(): Promise<CaptureListResult>;
  /** macOS: opens Privacy & Security > Screen Recording. */
  openScreenPermissionSettings(): Promise<void>;
  /** The source the next getDisplayMedia call should capture. */
  selectCaptureSource(id: string): Promise<void>;

  /** Per-app stream audio (Windows): only the game's sound, or everything except this app. */
  appAudioSupported(): Promise<boolean>;
  startAppAudio(sourceId: string): Promise<AppAudioStatus>;
  stopAppAudio(): Promise<void>;
  /** 16-bit stereo 48 kHz PCM chunks while app audio runs. */
  onAppAudio(cb: (chunk: ArrayBuffer) => void): () => void;

  /** Game detection (Windows): which game is open, for one-click streaming and "Playing …". */
  gamesSupported(): Promise<boolean>;
  setGameDetection(enabled: boolean): Promise<void>;
  currentGame(): Promise<DetectedGame | null>;
  onGameDetected(cb: (game: DetectedGame | null) => void): () => void;

  /** Global push-to-talk: works while a game has focus, and the game still gets the key. */
  setPttBinding(binding: PttBinding | null): Promise<void>;
  onPtt(cb: (pressed: boolean) => void): () => void;
  /** Resolves with the next key or mouse button pressed anywhere (for the keybind recorder). */
  recordPttBinding(): Promise<PttBinding | null>;

  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
  installUpdate(): Promise<void>;

  setTrayState(state: { muted: boolean; deafened: boolean; inVoice: boolean }): void;
  onTrayAction(cb: (action: 'toggle-mute' | 'toggle-deafen' | 'disconnect') => void): () => void;

  /** Seconds since the last keyboard or mouse input anywhere on the computer. */
  getIdleSeconds(): Promise<number>;
  /** Brings the window back, even from the tray. */
  showWindow(): void;
  /** Flashes the taskbar button if the window isn't focused. */
  requestAttention(): void;

  getLaunchAtLogin(): Promise<boolean>;
  setLaunchAtLogin(enabled: boolean): Promise<void>;
  setCloseToTray(enabled: boolean): Promise<void>;
  setTitleBarColor(color: string): void;
}
