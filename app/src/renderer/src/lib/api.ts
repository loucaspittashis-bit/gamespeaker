import { defaultServerUrl } from './platform';
import { settings } from './settings';

export type Channel = { id: string; name: string; kind: 'voice' | 'text'; topic?: string };
export type Me = { id: string; name: string; color: string };

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

async function request<T>(path: string, body?: unknown, session?: string | null): Promise<T> {
  let res: Response;
  try {
    res = await fetch(serverUrl() + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(session ? { authorization: `Bearer ${session}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach the server. Check your internet connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? `Server error (${res.status})`);
  return data as T;
}

export const api = {
  config: () => request<{ name: string; channels: Channel[]; livekitUrl: string }>('/api/config'),
  login: (body: { name: string; password: string; deviceId: string; color: string }) =>
    request<{ session: string; user: Me }>('/api/login', body),
  updateMe: (body: { name?: string; color?: string }, session: string) =>
    request<{ session: string; user: Me }>('/api/me', body, session),
  voiceToken: (room: string, session: string) =>
    request<{ token: string; url: string; room: string }>('/api/token', { room }, session),
};
