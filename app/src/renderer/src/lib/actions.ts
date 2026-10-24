import { app, setApp, toast, useApp, type PendingMessage } from '../state/store';
import { ApiError, adminApi, api, gatewaySocketUrl, type Attachment, type Channel, type Profile, type ProfilePatch } from './api';
import { GatewayClient, type ChatMessage } from './gateway';
import { initGames, playingNow } from './games';
import { mentionsMe } from './mentions';
import { currentCustom, currentStatus, initStatus, isDnd } from './status';
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
  updateSettings({ session: null, adminToken: null, adminExpiresAt: 0 });
  setApp({ phase: 'welcome', me: null, users: [], messages: {}, historyLoaded: {}, modal: null, adminAvailable: false, profiles: {}, profileCard: null });
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

const applyProfile = (profile: Profile) => setApp((s) => ({ profiles: { ...s.profiles, [profile.id]: profile } }));

/** Saves frame, colors or bio, or removes the photo or banner. Everyone sees it straight away. */
export async function editProfile(patch: ProfilePatch): Promise<boolean> {
  try {
    applyProfile(await api.updateProfile(patch));
    return true;
  } catch (err) {
    toast(err instanceof ApiError ? err.message : 'Could not save your profile', 'warn');
    return false;
  }
}

export async function uploadProfileImage(kind: 'avatar' | 'banner', image: Blob): Promise<boolean> {
  try {
    applyProfile(await api.uploadImage(kind, image));
    return true;
  } catch (err) {
    toast(err instanceof ApiError ? err.message : 'Could not upload that picture', 'warn');
    return false;
  }
}

/** A friend's stream we have on screen in the voice view (slot 2: side by side). */
function watchingNow(slot: 'focus' | 'focus2' = 'focus'): string | null {
  const s = app();
  const id = s[slot];
  if (!s.voiceChannel || s.view !== 'voice' || !id) return null;
  return s.streams.some((x) => x.id === id && !x.isLocal) ? id : null;
}

let lastPresence = '';
let watchingSubscribed = false;

/** Tells everyone our voice channel, mute and live state, status, game and what we're watching. Only sends changes. */
export function syncPresence(force = false): void {
  const s = app();
  const state = {
    t: 'state',
    channel: s.voiceChannel,
    muted: s.muted,
    deafened: s.deafened,
    live: s.myLive,
    playing: playingNow(),
    status: currentStatus(),
    custom: currentCustom(),
    watching: watchingNow(),
    watching2: watchingNow('focus2'),
  };
  const json = JSON.stringify(state);
  if ((force || json !== lastPresence) && gateway?.send(state)) lastPresence = json;
  bridge?.setTrayState({ muted: s.muted, deafened: s.deafened, inVoice: Boolean(s.voiceChannel) });
}

export function startSession(): void {
  const session = settings().session;
  if (!session) return;
  initVoice();
  onVoiceStateChange(() => syncPresence());
  initGames(() => syncPresence());
  initStatus(() => syncPresence());
  if (!watchingSubscribed) {
    watchingSubscribed = true;
    // What we're watching changes with focus and view, not with voice events.
    useApp.subscribe((s, prev) => {
      if (s.focus !== prev.focus || s.focus2 !== prev.focus2 || s.view !== prev.view || s.streams !== prev.streams) syncPresence();
    });
  }
  setApp({ phase: 'ready' });
  connectGateway(session);
}

function connectGateway(session: string): void {
  gateway = new GatewayClient(gatewaySocketUrl(), session, {
    onStatus: (gatewayStatus) => setApp({ gatewayStatus }),

    onReady: ({ you, serverName, channels, users, profiles, admin }) => {
      const firstText = channels.find((c) => c.kind === 'text')?.id ?? '';
      setApp((s) => ({
        me: you,
        serverName,
        channels,
        users,
        adminAvailable: Boolean(admin),
        profiles: Object.fromEntries((profiles ?? []).map((p) => [p.id, p])),
        textChannel: channels.some((c) => c.id === s.textChannel) ? s.textChannel : firstText,
      }));
      // Load recent history everywhere so unread dots are right from the start.
      for (const c of channels) gateway?.send({ t: 'history', channel: c.id, limit: 50 });
      // Resend anything typed while offline, and our voice state.
      for (const p of app().pending) gateway?.send({ t: 'chat', channel: p.channel, text: p.text, attachments: p.attachments, nonce: p.nonce });
      syncPresence(true);
    },

    onChannels: (channels) => applyChannels(channels),

    onServerName: (serverName) => setApp({ serverName }),

    onProfile: applyProfile,

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
      const me = app().me;
      if (!me || msg.userId === me.id) return;
      const visible = isChannelVisible(msg.channel);
      if (mentionsMe(msg.text, me.name)) {
        if (!visible) setApp((s) => ({ mentionCounts: { ...s.mentionCounts, [msg.channel]: (s.mentionCounts[msg.channel] ?? 0) + 1 } }));
        if (!isDnd() && (!visible || !document.hasFocus())) {
          sounds.mention();
          notifyMention(msg);
        }
      } else if (!visible && !isDnd()) {
        sounds.message();
      }
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
      if (code === 'invalid_attachments') toast("Those pictures couldn't be sent. Try attaching them again.", 'warn');
      if (code === 'slow_down') toast('Slow down a little', 'warn');
      if (code === 'invalid_text') toast('That message is too long (2000 characters max)', 'warn');
    },

    onInvalidSession: () => {
      toast('Please sign in again', 'warn');
      void logout();
    },

    onRemoved: (reason) => {
      toast(reason === 'banned' ? 'An admin banned this device from the server' : 'An admin removed you from the server', 'warn');
      void logout();
    },
  });
  gateway.connect();
}

/** An admin changed the channel list: follow along if ours was renamed or removed. */
function applyChannels(channels: Channel[]): void {
  const s = app();
  const isVoice = (id: string | null) => channels.some((c) => c.id === id && c.kind === 'voice');
  const isText = (id: string) => channels.some((c) => c.id === id && c.kind === 'text');
  if (s.voiceChannel && !isVoice(s.voiceChannel)) {
    void leaveVoice({ silent: true });
    toast('The voice channel you were in was deleted', 'warn');
  }
  setApp({
    channels,
    textChannel: isText(s.textChannel) ? s.textChannel : (channels.find((c) => c.kind === 'text')?.id ?? ''),
    view: s.view === 'voice' && s.voiceChannel && !isVoice(s.voiceChannel) ? 'text' : s.view,
  });
  for (const c of channels) if (!s.historyLoaded[c.id]) gateway?.send({ t: 'history', channel: c.id, limit: 50 });
}

/**
 * Changes the friends' password. The server signs everyone out, us included,
 * so we sign straight back in with the new password and stay in voice.
 */
export async function changeServerPassword(password: string): Promise<void> {
  const st = settings();
  gateway?.close();
  gateway = null;
  try {
    await adminApi.updateServer({ serverPassword: password });
  } catch (err) {
    if (st.session) connectGateway(st.session);
    throw err;
  }
  const { session, user } = await api.login({
    name: app().me?.name ?? st.nickname,
    password,
    deviceId: st.deviceId,
    color: app().me?.color ?? st.avatarColor,
  });
  updateSettings({ session });
  setApp({ me: user });
  connectGateway(session);
}

/** A desktop notification for an @mention; clicking it opens that chat. */
function notifyMention(msg: ChatMessage): void {
  bridge?.requestAttention();
  if (!settings().mentionNotifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const channel = app().channels.find((c) => c.id === msg.channel);
  const where = channel ? (channel.kind === 'text' ? `#${channel.name}` : `${channel.name} chat`) : 'chat';
  const body = msg.text || (msg.attachments?.length ? 'Sent a picture' : '');
  const n = new Notification(`${msg.name} mentioned you in ${where}`, { body: body.slice(0, 200), tag: `mention-${msg.channel}`, silent: true });
  n.onclick = () => {
    bridge?.showWindow();
    window.focus();
    if (channel?.kind === 'text') openTextChannel(channel.id);
    else if (channel) setApp({ view: 'voice', chatOpen: true });
    n.close();
  };
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

export function sendChat(channel: string, text: string, attachments: Attachment[] = []): void {
  const trimmed = text.trim();
  if (!trimmed && !attachments.length) return;
  const pending: PendingMessage = { nonce: crypto.randomUUID(), channel, text: trimmed, attachments, ts: Date.now() };
  setApp((s) => ({ pending: [...s.pending, pending] }));
  gateway?.send({ t: 'chat', channel, text: trimmed, attachments, nonce: pending.nonce });
}

export function retryPending(nonce: string): void {
  const p = app().pending.find((x) => x.nonce === nonce);
  if (!p) return;
  setApp((s) => ({ pending: s.pending.map((x) => (x.nonce === nonce ? { ...x, failed: false } : x)) }));
  gateway?.send({ t: 'chat', channel: p.channel, text: p.text, attachments: p.attachments, nonce: p.nonce });
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
  if (app().mentionCounts[channel]) setApp((s) => ({ mentionCounts: { ...s.mentionCounts, [channel]: 0 } }));
  const last = app().messages[channel]?.at(-1)?.id;
  if (last && (settings().lastRead[channel] ?? 0) < last) {
    updateSettings({ lastRead: { ...settings().lastRead, [channel]: last } });
  }
}

export function openTextChannel(channel: string): void {
  setApp({ view: 'text', textChannel: channel, fullscreen: false, ctxMenu: null, popover: null });
}
