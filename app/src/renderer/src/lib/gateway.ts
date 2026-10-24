import type { Channel, Me } from './api';

export type LiveInfo = { title: string; quality: string };

export type PresenceUser = {
  id: string;
  name: string;
  color: string;
  channel: string | null;
  muted: boolean;
  deafened: boolean;
  live: LiveInfo | null;
  since: number;
};

export type ChatMessage = {
  id: number;
  channel: string;
  userId: string;
  name: string;
  color: string;
  text: string;
  ts: number;
};

export type GatewayHandlers = {
  onStatus: (status: 'connecting' | 'online' | 'offline') => void;
  onReady: (data: { you: Me; serverName: string; channels: Channel[]; users: PresenceUser[] }) => void;
  onPresence: (users: PresenceUser[]) => void;
  onChat: (msg: ChatMessage, nonce?: string) => void;
  onHistory: (data: { channel: string; before: number | null; messages: ChatMessage[]; hasMore: boolean }) => void;
  onTyping: (data: { channel: string; userId: string; name: string }) => void;
  onError: (code: string, nonce?: string) => void;
  onInvalidSession: () => void;
};

// Presence + chat connection to the gateway. Reconnects with backoff and
// re-authenticates; the app re-sends its voice state on every "ready".
export class GatewayClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private retryTimer: number | null = null;
  private pingTimer: number | null = null;
  private url: string;
  private session: string;
  private h: GatewayHandlers;

  constructor(url: string, session: string, handlers: GatewayHandlers) {
    this.url = url;
    this.session = session;
    this.h = handlers;
  }

  connect(): void {
    this.closed = false;
    this.h.onStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'auth', session: this.session }));
    };

    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      switch (msg.t) {
        case 'ready':
          this.retry = 0;
          this.h.onStatus('online');
          this.h.onReady(msg);
          this.startPing();
          break;
        case 'presence':
          this.h.onPresence(msg.users);
          break;
        case 'chat':
          this.h.onChat(msg.msg, msg.nonce);
          break;
        case 'history':
          this.h.onHistory(msg);
          break;
        case 'typing':
          this.h.onTyping(msg);
          break;
        case 'error':
          if (msg.code === 'invalid_session') this.h.onInvalidSession();
          else this.h.onError(msg.code, msg.nonce);
          break;
      }
    };

    ws.onclose = (ev) => {
      this.stopPing();
      if (this.ws === ws) this.ws = null;
      if (this.closed) return;
      if (ev.code === 4003) {
        this.closed = true;
        this.h.onInvalidSession();
        return;
      }
      this.h.onStatus('offline');
      const delay = Math.min(10_000, 500 * 2 ** this.retry++) + Math.random() * 300;
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
    };
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: Record<string, unknown>): boolean {
    if (!this.connected) return false;
    this.ws!.send(JSON.stringify(msg));
    return true;
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), 20_000);
  }

  private stopPing(): void {
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
