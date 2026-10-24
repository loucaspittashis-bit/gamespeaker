import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DEFAULT_CHANNELS, type Config } from '../src/config.ts';
import { createGateway, type Gateway } from '../src/server.ts';

export const PASSWORD = 'correct horse battery staple';
export const ADMIN_PASSWORD = 'admin password for tests';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir: mkdtempSync(join(tmpdir(), 'gs-gateway-')),
    serverName: 'Test Server',
    serverPassword: PASSWORD,
    adminPassword: ADMIN_PASSWORD,
    sessionSecret: 'test-session-secret-that-is-long-enough-1234',
    livekitUrl: 'wss://example.test',
    // Nothing listens here: kick/close-room calls fail fast and are ignored.
    livekitHost: 'http://127.0.0.1:9',
    livekitApiKey: 'APItestkey',
    livekitApiSecret: 'test-livekit-secret-that-is-long-enough-123456',
    channels: DEFAULT_CHANNELS,
    minAppVersion: '0.1.10',
    ...overrides,
  };
}

export type Running = { gw: Gateway; config: Config; base: string; wsUrl: string; stop(): Promise<void> };

export async function start(overrides: Partial<Config> = {}): Promise<Running> {
  const config = testConfig(overrides);
  const gw = createGateway(config);
  await new Promise<void>((resolve) => gw.server.listen(0, '127.0.0.1', resolve));
  const { port } = gw.server.address() as AddressInfo;
  return {
    gw,
    config,
    base: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    stop: () => gw.close(),
  };
}

export async function api(
  base: string,
  path: string,
  opts: { method?: string; body?: unknown; session?: string; admin?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(opts.session ? { authorization: `Bearer ${opts.session}` } : {}),
      ...(opts.admin ? { 'x-admin-token': opts.admin } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

export async function login(base: string, name: string, deviceId: string, password = PASSWORD) {
  return api(base, '/api/login', { body: { name, deviceId, password } });
}

type Pred = (msg: any) => boolean;

export type TestSocket = {
  send(msg: unknown): void;
  next(pred?: Pred, timeoutMs?: number): Promise<any>;
  none(pred: Pred, waitMs?: number): Promise<void>;
  closed: Promise<{ code: number }>;
  close(): void;
};

export async function openSocket(wsUrl: string): Promise<TestSocket> {
  const ws = new WebSocket(wsUrl);
  const queue: any[] = [];
  const waiters: { pred: Pred; resolve: (m: any) => void; timer: NodeJS.Timeout }[] = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data));
    const i = waiters.findIndex((w) => w.pred(msg));
    if (i >= 0) {
      const [w] = waiters.splice(i, 1);
      clearTimeout(w!.timer);
      w!.resolve(msg);
    } else {
      queue.push(msg);
    }
  });
  const closed = new Promise<{ code: number }>((resolve) =>
    ws.addEventListener('close', (ev) => resolve({ code: ev.code })),
  );
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const next = (pred: Pred = () => true, timeoutMs = 2000) => {
    const i = queue.findIndex(pred);
    if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a matching message')), timeoutMs);
      waiters.push({ pred, resolve, timer });
    });
  };

  return {
    send: (msg) => ws.send(JSON.stringify(msg)),
    next,
    none: async (pred, waitMs = 300) => {
      await new Promise((r) => setTimeout(r, waitMs));
      if (queue.some(pred)) throw new Error('received a message that should not have arrived');
    },
    closed,
    close: () => ws.close(),
  };
}

export async function connect(wsUrl: string, session: string): Promise<{ sock: TestSocket; ready: any }> {
  const sock = await openSocket(wsUrl);
  sock.send({ t: 'auth', session });
  const ready = await sock.next((m) => m.t === 'ready');
  return { sock, ready };
}
