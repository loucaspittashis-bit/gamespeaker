import { create } from 'zustand';
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client';
import type { DetectedGame, UpdateStatus } from '../../../shared/bridge';
import type { Attachment, Channel, Me, Profile } from '../lib/api';
import type { ChatMessage, LiveInfo, PresenceUser } from '../lib/gateway';
import type { MicLevel } from '../lib/mic';

export type VoiceMember = {
  id: string;
  name: string;
  color: string;
  isLocal: boolean;
  speaking: boolean;
  micMuted: boolean;
  streaming: boolean;
};

export type StreamInfo = {
  id: string; // participant identity
  name: string;
  color: string;
  isLocal: boolean;
  track: RemoteVideoTrack | LocalVideoTrack | null;
  title: string;
  quality: string;
};

export type PendingMessage = { nonce: string; channel: string; text: string; attachments: Attachment[]; ts: number; failed?: boolean };

export type Toast = { id: number; text: string; tone: 'neon' | 'warn' };

export type SettingsSection = 'profile' | 'appearance' | 'voice' | 'keys' | 'stream' | 'app' | 'admin';

export type AppState = {
  phase: 'welcome' | 'ready';
  gatewayStatus: 'connecting' | 'online' | 'offline';
  me: Me | null;
  serverName: string;
  channels: Channel[];
  users: PresenceUser[];
  /** The server has an admin password set, so Settings shows Server admin. */
  adminAvailable: boolean;
  /** Photos, frames and bios by user id, including people who are offline. */
  profiles: Record<string, Profile>;
  /** The game open on this PC (Windows desktop app), for one-click streaming. */
  game: DetectedGame | null;
  gamesSupported: boolean;
  /** No keyboard or mouse for a while (auto-idle). */
  idle: boolean;
  /** Unread @mentions of you, by channel. */
  mentionCounts: Record<string, number>;
  /** A chat picture shown full size. */
  lightbox: string | null;
  /** An open profile card, placed beside the element that was clicked. */
  profileCard: { userId: string; left: number; right: number; top: number; name?: string; color?: string } | null;

  messages: Record<string, ChatMessage[]>;
  pending: PendingMessage[];
  hasMore: Record<string, boolean>;
  historyLoaded: Record<string, boolean>;
  typing: Record<string, Record<string, { name: string; until: number }>>;

  view: 'voice' | 'text';
  textChannel: string;

  voiceChannel: string | null;
  voiceStatus: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  members: VoiceMember[];
  streams: StreamInfo[];
  focus: string | null;
  pings: number[];
  muted: boolean;
  deafened: boolean;
  micLevel: MicLevel;
  myLive: LiveInfo | null;

  chatOpen: boolean;
  fullscreen: boolean;
  modal: null | 'golive' | 'settings';
  settingsSection: SettingsSection;
  ctxMenu: { userId: string; x: number; y: number } | null;
  popover: null | 'neon' | 'connection';
  toasts: Toast[];
  update: UpdateStatus;
};

export const useApp = create<AppState>()(() => ({
  phase: 'welcome',
  gatewayStatus: 'connecting',
  me: null,
  serverName: 'Gamespeaker',
  channels: [],
  users: [],
  adminAvailable: false,
  profiles: {},
  profileCard: null,
  game: null,
  gamesSupported: false,
  idle: false,
  mentionCounts: {},
  lightbox: null,

  messages: {},
  pending: [],
  hasMore: {},
  historyLoaded: {},
  typing: {},

  view: 'text',
  textChannel: 'general',

  voiceChannel: null,
  voiceStatus: 'idle',
  members: [],
  streams: [],
  focus: null,
  pings: [],
  muted: false,
  deafened: false,
  micLevel: { db: -100, open: false, threshold: -50 },
  myLive: null,

  chatOpen: true,
  fullscreen: false,
  modal: null,
  settingsSection: 'voice',
  ctxMenu: null,
  popover: null,
  toasts: [],
  update: { state: 'idle' },
}));

export const app = () => useApp.getState();
export const setApp = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => useApp.setState(patch);

let toastId = 0;
export function toast(text: string, tone: Toast['tone'] = 'neon'): void {
  const id = ++toastId;
  setApp((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
  window.setTimeout(() => setApp((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2800);
}

export function channelById(id: string | null): Channel | undefined {
  return id ? app().channels.find((c) => c.id === id) : undefined;
}
