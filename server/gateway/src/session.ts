import { createHmac, timingSafeEqual } from 'node:crypto';

// A session is what the app stores after the first login, so friends don't
// retype the password. It is an HMAC-signed blob, not a database row.

export type SessionUser = {
  sub: string; // stable device/user id, also the LiveKit identity
  name: string;
  color: string;
};

export type Session = SessionUser & {
  iat: number;
  exp: number;
  e: string; // password epoch: changes when SERVER_PASSWORD changes
};

export const SESSION_TTL_SEC = 60 * 60 * 24 * 90;

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

function mac(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

// Derived from the server password, so rotating the password signs everyone out.
export function passwordEpoch(password: string, secret: string): string {
  return mac(`epoch:${password}`, secret).toString('base64url').slice(0, 16);
}

// Derived from the admin password; a different prefix keeps admin tokens and
// sessions apart even if someone reuses the same password for both.
export function adminEpoch(adminPassword: string, secret: string): string {
  return mac(`admin-epoch:${adminPassword}`, secret).toString('base64url').slice(0, 16);
}

function sign(data: object, secret: string): string {
  const payload = b64(JSON.stringify(data));
  return `${payload}.${mac(payload, secret).toString('base64url')}`;
}

function verify(token: unknown, secret: string, now: number): Record<string, unknown> | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = mac(payload, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof data.exp !== 'number' || data.exp * 1000 < now) return null;
  return data;
}

export function signSession(user: SessionUser, secret: string, epoch: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const session: Session = { ...user, iat, exp: iat + SESSION_TTL_SEC, e: epoch };
  return sign(session, secret);
}

export function verifySession(token: unknown, secret: string, epoch: string, now = Date.now()): Session | null {
  const data = verify(token, secret, now);
  if (!data || data.k !== undefined || data.e !== epoch) return null;
  if (typeof data.sub !== 'string' || typeof data.name !== 'string' || typeof data.color !== 'string') return null;
  return data as unknown as Session;
}

export const ADMIN_TTL_SEC = 12 * 60 * 60;

/** A short-lived token that unlocks the admin API for one device. */
export function signAdmin(sub: string, secret: string, epoch: string, now = Date.now()): { token: string; exp: number } {
  const iat = Math.floor(now / 1000);
  const exp = iat + ADMIN_TTL_SEC;
  return { token: sign({ k: 'admin', sub, iat, exp, e: epoch }, secret), exp };
}

export function verifyAdmin(token: unknown, sub: string, secret: string, epoch: string, now = Date.now()): boolean {
  const data = verify(token, secret, now);
  return Boolean(data && data.k === 'admin' && data.sub === sub && data.e === epoch);
}
