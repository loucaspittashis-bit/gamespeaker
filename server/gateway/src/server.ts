import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { validateChannels, type Channel, type Config } from './config.ts';
import { adminEpoch, passwordEpoch, signAdmin, signSession, verifyAdmin, verifySession, type Session } from './session.ts';
import { RateLimiter } from './ratelimit.ts';
import { ChatStore } from './store.ts';
import { Presence, type LiveInfo, type StatePatch } from './presence.ts';
import { SettingsFile, type Ban } from './settings.ts';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_CHAT_CHARS = 2000;
const AUTH_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 25_000;
const LIVEKIT_TOKEN_TTL_SEC = 2 * 60 * 60;
const AVATAR_COLORS = ['#b3a6ff', '#ffb27a', '#6ee7c8', '#ff9ec4', '#8cc8ff', '#f5d76e'];
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// WebSocket close codes the app understands.
export const CLOSE_SIGNED_OUT = 4003; // session no longer valid (password changed)
export const CLOSE_KICKED = 4004; // removed by an admin
export const CLOSE_BANNED = 4005; // banned by an admin

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
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-admin-token');
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

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export function createGateway(config: Config): Gateway {
  mkdirSync(config.dataDir, { recursive: true });
  const store = new ChatStore(join(config.dataDir, 'chat.db'));
  const saved = new SettingsFile(join(config.dataDir, 'settings.json'));
  const presence = new Presence();
  const roomService = new RoomServiceClient(config.livekitHost, config.livekitApiKey, config.livekitApiSecret);
  const loginLimiter = new RateLimiter(10, 10 * 60_000);
  const adminLimiter = new RateLimiter(5, 10 * 60_000);
  const tokenLimiter = new RateLimiter(60, 60_000);
  const chatLimiter = new RateLimiter(8, 10_000);
  const conns = new Set<Conn>();

  // Live server settings: what the admin screen saved, else .env.
  let serverName = saved.data.serverName ?? config.serverName;
  let serverPassword = saved.data.serverPassword ?? config.serverPassword;
  let channels: Channel[] = saved.data.channels ?? config.channels;
  let banned: Ban[] = saved.data.banned ?? [];
  let epoch = passwordEpoch(serverPassword, config.sessionSecret);
  const adminEp = config.adminPassword ? adminEpoch(config.adminPassword, config.sessionSecret) : null;
  let voiceIds = new Set<string>();
  // Every channel has a chat: text channels, and the chat beside each voice channel.
  let chatIds = new Set<string>();
  const indexChannels = () => {
    voiceIds = new Set(channels.filter((c) => c.kind === 'voice').map((c) => c.id));
    chatIds = new Set(channels.map((c) => c.id));
  };
  indexChannels();
  const isBanned = (id: string) => banned.some((b) => b.id === id);

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

  const checkSession = (token: unknown): Session | null => {
    const session = verifySession(token, config.sessionSecret, epoch);
    return session && !isBanned(session.sub) ? session : null;
  };

  const requireSession = (req: IncomingMessage): Session => {
    const header = req.headers.authorization ?? '';
    const session = checkSession(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!session) throw new HttpError(401, 'invalid_session');
    return session;
  };

  const requireAdmin = (req: IncomingMessage): Session => {
    if (!adminEp) throw new HttpError(404, 'admin_disabled', 'The admin screen is turned off on this server.');
    const session = requireSession(req);
    const token = req.headers['x-admin-token'];
    if (!verifyAdmin(token, session.sub, config.sessionSecret, adminEp)) {
      throw new HttpError(403, 'admin_required', 'Unlock the admin screen again.');
    }
    return session;
  };

  const issue = (user: { sub: string; name: string; color: string }) => ({
    session: signSession(user, config.sessionSecret, epoch),
    user: { id: user.sub, name: user.name, color: user.color },
  });

  /** Disconnects a user everywhere: presence/chat sockets and any voice room. */
  const disconnectUser = async (userId: string, code: number, reason: string) => {
    const room = presence.list().find((u) => u.id === userId)?.channel;
    for (const c of conns) if (c.session?.sub === userId) c.ws.close(code, reason);
    if (room) await roomService.removeParticipant(room, userId).catch(() => {});
  };

  const adminState = () => ({
    serverName,
    channels,
    online: presence.list(),
    banned,
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
      sendJson(res, 200, { name: serverName, channels, livekitUrl: config.livekitUrl, admin: Boolean(adminEp) });
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
      if (!safeEqual(password, serverPassword)) {
        log(`login failed ip=${ip}`);
        throw new HttpError(401, 'wrong_password', 'That password is not right.');
      }
      if (isBanned(deviceId)) {
        log(`login refused (banned) ip=${ip}`);
        throw new HttpError(403, 'banned', 'This device has been banned from the server.');
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

    // ---- admin ----

    if (req.method === 'POST' && path === '/api/admin/unlock') {
      if (!adminEp || !config.adminPassword) throw new HttpError(404, 'admin_disabled', 'The admin screen is turned off on this server.');
      const session = requireSession(req);
      const ip = clientIp(req);
      if (!adminLimiter.hit(ip)) {
        res.setHeader('Retry-After', String(adminLimiter.retryAfterSec(ip)));
        throw new HttpError(429, 'too_many_attempts', 'Too many attempts. Wait a few minutes and try again.');
      }
      const body = await readJson(req);
      const password = typeof body.password === 'string' ? body.password : '';
      if (!safeEqual(password, config.adminPassword)) {
        log(`admin unlock failed name=${JSON.stringify(session.name)} ip=${ip}`);
        throw new HttpError(403, 'wrong_admin_password', 'That admin password is not right.');
      }
      adminLimiter.reset(ip);
      log(`admin unlocked name=${JSON.stringify(session.name)} ip=${ip}`);
      const { token, exp } = signAdmin(session.sub, config.sessionSecret, adminEp);
      sendJson(res, 200, { adminToken: token, expiresAt: exp * 1000, ...adminState() });
      return;
    }

    if (req.method === 'GET' && path === '/api/admin/state') {
      requireAdmin(req);
      sendJson(res, 200, adminState());
      return;
    }

    if (req.method === 'POST' && path === '/api/admin/channels') {
      const admin = requireAdmin(req);
      const body = await readJson(req);
      let next: Channel[];
      try {
        next = validateChannels(body.channels);
      } catch (err) {
        throw new HttpError(400, 'invalid_channels', err instanceof Error ? err.message : String(err));
      }
      const removedVoice = channels.filter((c) => c.kind === 'voice' && !next.some((n) => n.id === c.id && n.kind === 'voice'));
      channels = next;
      indexChannels();
      saved.update({ channels });
      // Close the voice rooms of deleted channels and clear anyone's presence there.
      for (const c of removedVoice) {
        await roomService.deleteRoom(c.id).catch(() => {});
        for (const u of presence.list()) if (u.channel === c.id) presence.update(u.id, { channel: null });
      }
      broadcast({ t: 'channels', channels });
      broadcastPresence();
      log(`admin ${JSON.stringify(admin.name)} saved ${channels.length} channels`);
      sendJson(res, 200, adminState());
      return;
    }

    if (req.method === 'POST' && path === '/api/admin/server') {
      const admin = requireAdmin(req);
      const body = await readJson(req);
      let signedOut = false;
      if (body.serverName !== undefined) {
        const name = String(body.serverName).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
        if (name.length < 1 || name.length > 40) throw new HttpError(400, 'invalid_name', 'Server names must be 1 to 40 characters.');
        serverName = name;
        saved.update({ serverName });
        broadcast({ t: 'server', serverName });
        log(`admin ${JSON.stringify(admin.name)} renamed the server`);
      }
      if (body.serverPassword !== undefined) {
        const pw = String(body.serverPassword);
        if (pw.length < 6 || pw.length > 128) throw new HttpError(400, 'invalid_password', 'Use a password of at least 6 characters.');
        serverPassword = pw;
        epoch = passwordEpoch(serverPassword, config.sessionSecret);
        saved.update({ serverPassword });
        // Every existing session is now invalid: sign everyone out.
        for (const c of conns) if (c.session) c.ws.close(CLOSE_SIGNED_OUT, 'password changed');
        signedOut = true;
        log(`admin ${JSON.stringify(admin.name)} changed the server password`);
      }
      sendJson(res, 200, { ...adminState(), signedOut });
      return;
    }

    if (req.method === 'POST' && (path === '/api/admin/kick' || path === '/api/admin/ban')) {
      const admin = requireAdmin(req);
      const body = await readJson(req);
      const userId = typeof body.userId === 'string' && DEVICE_ID.test(body.userId) ? body.userId : '';
      if (!userId) throw new HttpError(400, 'invalid_user');
      if (userId === admin.sub) throw new HttpError(400, 'cannot_target_self', "You can't kick or ban yourself.");
      const user = presence.list().find((u) => u.id === userId);
      if (path === '/api/admin/ban') {
        if (!isBanned(userId)) {
          banned = [...banned, { id: userId, name: user?.name ?? String(body.name ?? 'unknown').slice(0, 32), at: Date.now() }];
          saved.update({ banned });
        }
        await disconnectUser(userId, CLOSE_BANNED, 'banned');
        log(`admin ${JSON.stringify(admin.name)} banned ${JSON.stringify(user?.name ?? userId)}`);
      } else {
        await disconnectUser(userId, CLOSE_KICKED, 'kicked');
        log(`admin ${JSON.stringify(admin.name)} kicked ${JSON.stringify(user?.name ?? userId)}`);
      }
      sendJson(res, 200, adminState());
      return;
    }

    if (req.method === 'POST' && path === '/api/admin/unban') {
      const admin = requireAdmin(req);
      const body = await readJson(req);
      const userId = typeof body.userId === 'string' ? body.userId : '';
      banned = banned.filter((b) => b.id !== userId);
      saved.update({ banned });
      log(`admin ${JSON.stringify(admin.name)} unbanned ${userId}`);
      sendJson(res, 200, adminState());
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
        const session = checkSession(msg.session);
        if (!session) {
          send(conn, { t: 'error', code: 'invalid_session' });
          ws.close(CLOSE_SIGNED_OUT, 'invalid session');
          return;
        }
        clearTimeout(authTimer);
        conn.session = session;
        presence.connect({ id: session.sub, name: session.name, color: session.color });
        send(conn, {
          t: 'ready',
          you: { id: session.sub, name: session.name, color: session.color },
          serverName,
          channels,
          users: presence.list(),
          admin: Boolean(adminEp),
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
