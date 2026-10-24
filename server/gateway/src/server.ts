import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { AccessToken } from 'livekit-server-sdk';
import type { Config } from './config.ts';
import { passwordEpoch, signSession, verifySession, type Session } from './session.ts';
import { RateLimiter } from './ratelimit.ts';
import { ChatStore } from './store.ts';
import { Presence, type LiveInfo, type StatePatch } from './presence.ts';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_CHAT_CHARS = 2000;
const AUTH_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 25_000;
const LIVEKIT_TOKEN_TTL_SEC = 2 * 60 * 60;
const AVATAR_COLORS = ['#b3a6ff', '#ffb27a', '#6ee7c8', '#ff9ec4', '#8cc8ff', '#f5d76e'];
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export type Gateway = {
  server: Server;
  presence: Presence;
  store: ChatStore;
  close(): Promise<void>;
};

type Conn = {
  ws: WebSocket;
  session: Session | null;
  alive: boolean;
  lastTyping: number;
};

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

const sha256 = (s: string) => createHash('sha256').update(s).digest();

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Strip control characters, collapse whitespace.
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return name.length >= 1 && name.length <= 32 ? name : null;
}

function pickColor(id: string): string {
  const n = sha256(id).readUInt32BE(0);
  return AVATAR_COLORS[n % AVATAR_COLORS.length]!;
}

function isLoopback(addr: string): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// Behind Caddy every request comes from loopback; Caddy sets X-Forwarded-For
// to the real client address and ignores whatever the client sent.
function clientIp(req: IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? 'unknown';
  const xff = req.headers['x-forwarded-for'];
  if (xff && isLoopback(remote)) {
    const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean);
    return parts[parts.length - 1] ?? remote;
  }
  return remote;
}

function setCors(res: ServerResponse): void {
  // Auth is a bearer token, never a cookie, so any origin (desktop app, web) is fine.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, 'invalid_json');
}

function parseLive(raw: unknown): LiveInfo | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'object') return undefined;
  const { title, quality } = raw as Record<string, unknown>;
  if (typeof title !== 'string' || typeof quality !== 'string') return undefined;
  return { title: title.slice(0, 80), quality: quality.slice(0, 60) };
}

export function createGateway(config: Config): Gateway {
  mkdirSync(config.dataDir, { recursive: true });
  const store = new ChatStore(join(config.dataDir, 'chat.db'));
  const presence = new Presence();
  const epoch = passwordEpoch(config.serverPassword, config.sessionSecret);
  const passwordHash = sha256(config.serverPassword);
  const loginLimiter = new RateLimiter(10, 10 * 60_000);
  const tokenLimiter = new RateLimiter(60, 60_000);
  const chatLimiter = new RateLimiter(8, 10_000);
  const voiceIds = new Set(config.channels.filter((c) => c.kind === 'voice').map((c) => c.id));
  // Every channel has a chat: text channels, and the chat beside each voice channel.
  const chatIds = new Set(config.channels.map((c) => c.id));
  const conns = new Set<Conn>();

  const authed = () => [...conns].filter((c) => c.session && c.ws.readyState === WebSocket.OPEN);
  const send = (c: Conn, msg: unknown) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg: unknown, except?: Conn) => {
    const data = JSON.stringify(msg);
    for (const c of authed()) if (c !== except) c.ws.send(data);
  };

  let presenceTimer: NodeJS.Timeout | null = null;
  const broadcastPresence = () => {
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      broadcast({ t: 'presence', users: presence.list() });
    }, 30);
  };

  const requireSession = (req: IncomingMessage): Session => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const session = verifySession(token, config.sessionSecret, epoch);
    if (!session) throw new HttpError(401, 'invalid_session');
    return session;
  };

  const issue = (user: { sub: string; name: string; color: string }) => ({
    session: signSession(user, config.sessionSecret, epoch),
    user: { id: user.sub, name: user.name, color: user.color },
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setCors(res);
    const url = new URL(req.url ?? '/', 'http://gateway');
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === 'GET' && path === '/api/health') {
      sendJson(res, 200, { ok: true, online: presence.list().length });
      return;
    }

    if (req.method === 'GET' && path === '/api/config') {
      sendJson(res, 200, { name: config.serverName, channels: config.channels, livekitUrl: config.livekitUrl });
      return;
    }

    if (req.method === 'POST' && path === '/api/login') {
      const ip = clientIp(req);
      if (!loginLimiter.hit(ip)) {
        res.setHeader('Retry-After', String(loginLimiter.retryAfterSec(ip)));
        throw new HttpError(429, 'too_many_attempts', 'Too many attempts. Wait a few minutes and try again.');
      }
      const body = await readJson(req);
      const name = cleanName(body.name);
      if (!name) throw new HttpError(400, 'invalid_name', 'Pick a nickname between 1 and 32 characters.');
      const deviceId = typeof body.deviceId === 'string' && DEVICE_ID.test(body.deviceId) ? body.deviceId : null;
      if (!deviceId) throw new HttpError(400, 'invalid_device');
      const password = typeof body.password === 'string' ? body.password : '';
      if (!timingSafeEqual(sha256(password), passwordHash)) {
        log(`login failed ip=${ip}`);
        throw new HttpError(401, 'wrong_password', 'That password is not right.');
      }
      loginLimiter.reset(ip);
      const color = typeof body.color === 'string' && HEX_COLOR.test(body.color) ? body.color.toLowerCase() : pickColor(deviceId);
      log(`login ok name=${JSON.stringify(name)} ip=${ip}`);
      sendJson(res, 200, issue({ sub: deviceId, name, color }));
      return;
    }

    if (req.method === 'POST' && path === '/api/me') {
      const session = requireSession(req);
      const body = await readJson(req);
      const name = body.name === undefined ? session.name : cleanName(body.name);
      if (!name) throw new HttpError(400, 'invalid_name', 'Pick a nickname between 1 and 32 characters.');
      const color = typeof body.color === 'string' && HEX_COLOR.test(body.color) ? body.color.toLowerCase() : session.color;
      if (presence.update(session.sub, { name, color })) broadcastPresence();
      for (const c of conns) if (c.session?.sub === session.sub) c.session = { ...c.session, name, color };
      sendJson(res, 200, issue({ sub: session.sub, name, color }));
      return;
    }

    if (req.method === 'POST' && path === '/api/token') {
      const session = requireSession(req);
      if (!tokenLimiter.hit(session.sub)) throw new HttpError(429, 'too_many_requests');
      const body = await readJson(req);
      const room = typeof body.room === 'string' ? body.room : '';
      if (!voiceIds.has(room)) throw new HttpError(400, 'unknown_room');
      const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
        identity: session.sub,
        name: session.name,
        metadata: JSON.stringify({ color: session.color }),
        ttl: LIVEKIT_TOKEN_TTL_SEC,
      });
      at.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateOwnMetadata: true,
      });
      sendJson(res, 200, { token: await at.toJwt(), url: config.livekitUrl, room });
      return;
    }

    log(`404 ${req.method} ${path}`);
    throw new HttpError(404, 'not_found');
  }

  const server = createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.code, message: err.message });
      } else {
        log('request failed', err);
        sendJson(res, 500, { error: 'internal' });
      }
    });
  });

  // ---- WebSocket: presence, chat, typing ----

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://gateway');
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  });

  function onConnection(ws: WebSocket): void {
    const conn: Conn = { ws, session: null, alive: true, lastTyping: 0 };
    conns.add(conn);
    const authTimer = setTimeout(() => ws.close(4001, 'auth timeout'), AUTH_TIMEOUT_MS);

    ws.on('pong', () => {
      conn.alive = true;
    });

    ws.on('message', (data: RawData) => {
      let msg: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(data.toString());
        if (!parsed || typeof parsed !== 'object') return;
        msg = parsed as Record<string, unknown>;
      } catch {
        return;
      }

      if (!conn.session) {
        if (msg.t !== 'auth') {
          ws.close(4001, 'auth required');
          return;
        }
        const session = verifySession(msg.session, config.sessionSecret, epoch);
        if (!session) {
          send(conn, { t: 'error', code: 'invalid_session' });
          ws.close(4003, 'invalid session');
          return;
        }
        clearTimeout(authTimer);
        conn.session = session;
        presence.connect({ id: session.sub, name: session.name, color: session.color });
        send(conn, {
          t: 'ready',
          you: { id: session.sub, name: session.name, color: session.color },
          serverName: config.serverName,
          channels: config.channels,
          users: presence.list(),
        });
        broadcastPresence();
        return;
      }

      handleMessage(conn, conn.session, msg);
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      conns.delete(conn);
      if (conn.session && presence.disconnect(conn.session.sub)) broadcastPresence();
    });

    ws.on('error', () => ws.terminate());
  }

  function handleMessage(conn: Conn, session: Session, msg: Record<string, unknown>): void {
    switch (msg.t) {
      case 'state': {
        const patch: StatePatch = {};
        if (msg.channel === null || (typeof msg.channel === 'string' && voiceIds.has(msg.channel))) {
          patch.channel = msg.channel;
        }
        if (typeof msg.muted === 'boolean') patch.muted = msg.muted;
        if (typeof msg.deafened === 'boolean') patch.deafened = msg.deafened;
        const live = parseLive(msg.live);
        if (live !== undefined) patch.live = live;
        if (presence.update(session.sub, patch)) broadcastPresence();
        return;
      }

      case 'chat': {
        const channel = typeof msg.channel === 'string' ? msg.channel : '';
        const text = typeof msg.text === 'string' ? msg.text.trim() : '';
        const nonce = typeof msg.nonce === 'string' ? msg.nonce.slice(0, 64) : undefined;
        if (!chatIds.has(channel)) return send(conn, { t: 'error', code: 'unknown_channel', nonce });
        if (!text || text.length > MAX_CHAT_CHARS) return send(conn, { t: 'error', code: 'invalid_text', nonce });
        if (!chatLimiter.hit(session.sub)) return send(conn, { t: 'error', code: 'slow_down', nonce });
        const saved = store.add({
          channel, userId: session.sub, name: session.name, color: session.color, text, ts: Date.now(),
        });
        broadcast({ t: 'chat', msg: saved, nonce });
        return;
      }

      case 'typing': {
        const channel = typeof msg.channel === 'string' ? msg.channel : '';
        const now = Date.now();
        if (!chatIds.has(channel) || now - conn.lastTyping < 2000) return;
        conn.lastTyping = now;
        broadcast({ t: 'typing', channel, userId: session.sub, name: session.name }, conn);
        return;
      }

      case 'history': {
        const channel = typeof msg.channel === 'string' ? msg.channel : '';
        if (!chatIds.has(channel)) return send(conn, { t: 'error', code: 'unknown_channel' });
        const before = typeof msg.before === 'number' && msg.before > 0 ? msg.before : undefined;
        const limit = typeof msg.limit === 'number' ? Math.min(Math.max(1, Math.floor(msg.limit)), 100) : 50;
        send(conn, { t: 'history', channel, before: before ?? null, ...store.history(channel, before, limit) });
        return;
      }

      case 'ping':
        send(conn, { t: 'pong' });
        return;

      default:
        send(conn, { t: 'error', code: 'unknown_type' });
    }
  }

  const heartbeat = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, HEARTBEAT_MS);

  return {
    server,
    presence,
    store,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        if (presenceTimer) clearTimeout(presenceTimer);
        for (const c of conns) c.ws.terminate();
        wss.close();
        server.closeAllConnections();
        server.close(() => {
          store.close();
          resolve();
        });
      }),
  };
}
