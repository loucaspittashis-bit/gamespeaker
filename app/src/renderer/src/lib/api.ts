import type { PresenceUser } from './gateway';
import { defaultServerUrl } from './platform';
import { settings } from './settings';

export type Channel = { id: string; name: string; kind: 'voice' | 'text'; topic?: string };
export type Me = { id: string; name: string; color: string };
export type Ban = { id: string; name: string; at: number };
export type Profile = {
  id: string;
  avatar: string | null;
  banner: string | null;
  bannerColor: string | null;
  frame: string | null;
  frameColor: string | null;
  bio: string;
  updated: number;
};
/** A picture in a chat message. */
export type Attachment = { file: string; width: number; height: number };
export type ProfilePatch = Partial<Pick<Profile, 'frame' | 'frameColor' | 'bannerColor' | 'bio'>> & { avatar?: null; banner?: null };
export const MAX_BIO_CHARS = 190;
/** Upload limits, the same as the server's. */
export const MAX_UPLOAD_BYTES = { avatar: 5 * 1024 * 1024, banner: 8 * 1024 * 1024, chat: 8 * 1024 * 1024 };
export const MAX_ATTACHMENTS = 4;
export type AdminState = { serverName: string; channels: Channel[]; online: PresenceUser[]; banned: Ban[] };

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function serverUrl(): string {
  return (settings().serverUrl || defaultServerUrl()).replace(/\/+$/, '');
}

export function gatewaySocketUrl(): string {
  return serverUrl().replace(/^http/, 'ws') + '/ws';
}

/** Where a stored picture (profile photo, banner) can be loaded from. */
export const mediaUrl = (file: string) => `${serverUrl()}/api/media/${file}`;

async function request<T>(path: string, body?: unknown, session?: string | null, adminToken?: string | null): Promise<T> {
  let res: Response;
  const raw = body instanceof Blob;
  try {
    res = await fetch(serverUrl() + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': raw ? body.type || 'application/octet-stream' : 'application/json' }),
        ...(session ? { authorization: `Bearer ${session}` } : {}),
        ...(adminToken ? { 'x-admin-token': adminToken } : {}),
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach the server. Check your internet connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? `Server error (${res.status})`);
  return data as T;
}

export const api = {
  config: () => request<{ name: string; channels: Channel[]; livekitUrl: string; admin: boolean }>('/api/config'),
  login: (body: { name: string; password: string; deviceId: string; color: string }) =>
    request<{ session: string; user: Me }>('/api/login', body),
  updateMe: (body: { name?: string; color?: string }, session: string) =>
    request<{ session: string; user: Me }>('/api/me', body, session),
  voiceToken: (room: string, session: string) =>
    request<{ token: string; url: string; room: string }>('/api/token', { room }, session),
  /** Uploads a profile photo or banner (PNG, JPG, WebP or GIF). */
  uploadImage: (kind: 'avatar' | 'banner', image: Blob) => request<Profile>(`/api/me/${kind}`, image, settings().session),
  updateProfile: (patch: ProfilePatch) => request<Profile>('/api/me/profile', patch, settings().session),
  uploadChatImage: (image: Blob) => request<Attachment>('/api/chat/upload', image, settings().session),
};

const asAdmin = <T>(path: string, body?: unknown) => request<T>(path, body, settings().session, settings().adminToken);

/** Settings > Server admin. Everything but unlock needs the token unlock returns. */
export const adminApi = {
  unlock: (password: string) =>
    request<AdminState & { adminToken: string; expiresAt: number }>('/api/admin/unlock', { password }, settings().session),
  state: () => asAdmin<AdminState>('/api/admin/state'),
  saveChannels: (channels: Channel[]) => asAdmin<AdminState>('/api/admin/channels', { channels }),
  updateServer: (patch: { serverName?: string; serverPassword?: string }) =>
    asAdmin<AdminState & { signedOut: boolean }>('/api/admin/server', patch),
  kick: (userId: string) => asAdmin<AdminState>('/api/admin/kick', { userId }),
  ban: (userId: string, name: string) => asAdmin<AdminState>('/api/admin/ban', { userId, name }),
  unban: (userId: string) => asAdmin<AdminState>('/api/admin/unban', { userId }),
};
