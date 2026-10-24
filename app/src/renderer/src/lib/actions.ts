import { app, setApp, toast, type PendingMessage } from '../state/store';
import { ApiError, api, gatewaySocketUrl } from './api';
import { GatewayClient, type ChatMessage } from './gateway';
import { bridge } from './platform';
import { settings, updateSettings } from './settings';
import { sounds } from './sounds';
import { initVoice, leaveVoice, onVoiceStateChange, refresh } from './voice';

let gateway: GatewayClient | null = null;
let lastTypingSent = 0;

export async function login(input: { name: string; password: string; color: string }): Promise<void> {
  const { session, user } = await api.login({
    name: input.name,
    password: input.password,
    deviceId: settings().deviceId,
    color: input.color,
  });
  updateSettings({ session, nickname: user.name, avatarColor: user.color });
  startSession();
}

export async function logout(): Promise<void> {
  await leaveVoice({ silent: true });
  gateway?.close();
  gateway = null;
  updateSettings({ session: null });
  setApp({ phase: 'welcome', me: null, users: [], messages: {}, historyLoaded: {}, modal: null });
}

export async function updateProfile(patch: { name?: string; color?: string }): Promise<void> {
  const session = settings().session;
  if (!session) return;
  try {
    const res = await api.updateMe(patch, session);
    updateSettings({ session: res.session, nickname: res.user.name, avatarColor: res.user.color });
    setApp({ me: res.user });
    // Reconnect presence with the new session so the new name sticks.
    gateway?.close();
    connectGateway(res.session);
  } catch (err) {
    toast(err instanceof ApiError ? err.message : 'Could not save your profile', 'warn');
  }
}

/** Tells everyone which voice channel we're in, and whether we're muted or live. */
export function syncPresence(): void {
  const s = app();
  gateway?.send({
    t: 'state',
    channel: s.voiceChannel,
    muted: s.muted,
    deafened: s.deafened,
    live: s.myLive,
  });
  bridge?.setTrayState({ muted: s.muted, deafened: s.deafened, inVoice: Boolean(s.voiceChannel) });
}

export function startSession(): void {
  const session = settings().session;
  if (!session) return;
  initVoice();
  onVoiceStateChange(syncPresence);
  setApp({ phase: 'ready' });
  connectGateway(session);
}

function connectGateway(session: string): void {
  gateway = new GatewayClient(gatewaySocketUrl(), session, {
    onStatus: (gatewayStatus) => setApp({ gatewayStatus }),

    onReady: ({ you, serverName, channels, users }) => {
      const firstText = channels.find((c) => c.kind === 'text')?.id ?? '';
      setApp((s) => ({
        me: you,
        serverName,
        channels,
        users,
        textChannel: channels.some((c) => c.id === s.textChannel) ? s.textChannel : firstText,
      }));
      // Load recent history everywhere so unread dots are right from the start.
      for (const c of channels) gateway?.send({ t: 'history', channel: c.id, limit: 50 });
      // Resend anything typed while offline, and our voice state.
      for (const p of app().pending) gateway?.send({ t: 'chat', channel: p.channel, text: p.text, nonce: p.nonce });
      syncPresence();
    },

    onPresence: (users) => {
      setApp({ users });
      refresh();
    },

    onChat: (msg, nonce) => {
      setApp((s) => ({
        messages: { ...s.messages, [msg.channel]: [...(s.messages[msg.channel] ?? []), msg] },
        pending: nonce ? s.pending.filter((p) => p.nonce !== nonce) : s.pending,
        typing: removeTyping(s.typing, msg.channel, msg.userId),
      }));
      if (msg.userId !== app().me?.id && !isChannelVisible(msg.channel)) sounds.message();
    },

    onHistory: ({ channel, before, messages, hasMore }) => {
      setApp((s) => {
        const existing = s.messages[channel] ?? [];
        const merged = before ? [...messages, ...existing] : mergeById(messages, existing);
        return {
          messages: { ...s.messages, [channel]: merged },
          hasMore: { ...s.hasMore, [channel]: hasMore },
          historyLoaded: { ...s.historyLoaded, [channel]: true },
        };
      });
    },

    onTyping: ({ channel, userId, name }) => {
      setApp((s) => ({
        typing: { ...s.typing, [channel]: { ...(s.typing[channel] ?? {}), [userId]: { name, until: Date.now() + 4000 } } },
      }));
    },

    onError: (code, nonce) => {
      if (nonce) setApp((s) => ({ pending: s.pending.map((p) => (p.nonce === nonce ? { ...p, failed: true } : p)) }));
      if (code === 'slow_down') toast('Slow down a little', 'warn');
      if (code === 'invalid_text') toast('That message is too long (2000 characters max)', 'warn');
    },

    onInvalidSession: () => {
      toast('Please sign in again', 'warn');
      void logout();
    },
  });
  gateway.connect();
}

function mergeById(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const map = new Map<number, ChatMessage>();
  for (const m of [...a, ...b]) map.set(m.id, m);
  return [...map.values()].sort((x, y) => x.id - y.id);
}

function removeTyping(typing: ReturnType<typeof app>['typing'], channel: string, userId: string) {
  if (!typing[channel]?.[userId]) return typing;
  const { [userId]: _gone, ...rest } = typing[channel]!;
  return { ...typing, [channel]: rest };
}

export function isChannelVisible(channel: string): boolean {
  const s = app();
  if (document.hidden) return false;
  if (s.view === 'text') return s.textChannel === channel;
  return s.voiceChannel === channel && s.chatOpen;
}

export function sendChat(channel: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const pending: PendingMessage = { nonce: crypto.randomUUID(), channel, text: trimmed, ts: Date.now() };
  setApp((s) => ({ pending: [...s.pending, pending] }));
  gateway?.send({ t: 'chat', channel, text: trimmed, nonce: pending.nonce });
}

export function retryPending(nonce: string): void {
  const p = app().pending.find((x) => x.nonce === nonce);
  if (!p) return;
  setApp((s) => ({ pending: s.pending.map((x) => (x.nonce === nonce ? { ...x, failed: false } : x)) }));
  gateway?.send({ t: 'chat', channel: p.channel, text: p.text, nonce: p.nonce });
}

export function loadOlder(channel: string): void {
  const first = app().messages[channel]?.[0];
  if (first) gateway?.send({ t: 'history', channel, before: first.id, limit: 50 });
}

export function sendTyping(channel: string): void {
  const now = Date.now();
  if (now - lastTypingSent < 2500) return;
  lastTypingSent = now;
  gateway?.send({ t: 'typing', channel });
}

export function markRead(channel: string): void {
  const last = app().messages[channel]?.at(-1)?.id;
  if (last && (settings().lastRead[channel] ?? 0) < last) {
    updateSettings({ lastRead: { ...settings().lastRead, [channel]: last } });
  }
}

export function openTextChannel(channel: string): void {
  setApp({ view: 'text', textChannel: channel, fullscreen: false, ctxMenu: null, popover: null });
}
