import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PttBinding } from '../../../shared/bridge';

export type Glow = 'off' | 'soft' | 'full';
export type InputMode = 'va' | 'ptt';
export type NoiseLevel = 'off' | 'standard' | 'high';
export type Resolution = '720p' | '1080p' | '1440p' | '4K';

export type WebPtt = { code: string; label: string };

export type Settings = {
  // identity
  deviceId: string;
  session: string | null;
  serverUrl: string | null; // override; null = default
  nickname: string;
  avatarColor: string;

  // appearance
  neon: string;
  glow: Glow;

  // voice
  inputDevice: string;
  outputDevice: string;
  inputVolume: number; // 0-200 %
  outputVolume: number; // 0-200 %
  inputMode: InputMode;
  autoSensitivity: boolean;
  sensitivity: number; // dB, -100..0
  pttDesktop: PttBinding | null;
  pttWeb: WebPtt | null;
  pttRelease: number; // ms
  noise: NoiseLevel;
  echoCancellation: boolean;
  autoGain: boolean;
  packetLossProtection: boolean;

  // people
  userVolumes: Record<string, number>; // userId -> 0-200 %
  userMuted: Record<string, boolean>;
  streamVolumes: Record<string, number>;

  // streaming
  streamRes: Resolution;
  streamFps: 30 | 60;
  codecPref: 'auto' | 'h264';
  showStreamStats: boolean;

  // chat
  lastRead: Record<string, number>; // channel -> last seen message id

  // desktop
  closeToTray: boolean;
};

export const AVATAR_COLORS = ['#b3a6ff', '#ffb27a', '#6ee7c8', '#ff9ec4', '#8cc8ff', '#f5d76e'];

const defaults: Settings = {
  deviceId: crypto.randomUUID(),
  session: null,
  serverUrl: null,
  nickname: '',
  avatarColor: AVATAR_COLORS[0]!,
  neon: '#2de2ff',
  glow: 'full',
  inputDevice: 'default',
  outputDevice: 'default',
  inputVolume: 100,
  outputVolume: 100,
  inputMode: 'va',
  autoSensitivity: true,
  sensitivity: -50,
  pttDesktop: { kind: 'mouse', button: 4, label: 'Mouse 4' },
  pttWeb: { code: 'Backquote', label: '`' },
  pttRelease: 200,
  noise: 'standard',
  echoCancellation: true,
  autoGain: true,
  packetLossProtection: true,
  userVolumes: {},
  userMuted: {},
  streamVolumes: {},
  streamRes: '1440p',
  streamFps: 60,
  codecPref: 'auto',
  showStreamStats: true,
  lastRead: {},
  closeToTray: true,
};

type SettingsStore = Settings & {
  set: (patch: Partial<Settings>) => void;
};

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...defaults,
      set: (patch) => set(patch),
    }),
    {
      name: 'gamespeaker.settings',
      version: 1,
      partialize: ({ set: _set, ...rest }) => rest,
    },
  ),
);

export const settings = () => useSettings.getState();
export const updateSettings = (patch: Partial<Settings>) => useSettings.getState().set(patch);
