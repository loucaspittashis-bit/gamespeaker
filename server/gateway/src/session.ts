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

export function signSession(user: SessionUser, secret: string, epoch: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const session: Session = { ...user, iat, exp: iat + SESSION_TTL_SEC, e: epoch };
  const payload = b64(JSON.stringify(session));
  return `${payload}.${mac(payload, secret).toString('base64url')}`;
}

export function verifySession(token: unknown, secret: string, epoch: string, now = Date.now()): Session | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = mac(payload, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let session: Session;
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (session.e !== epoch) return null;
  if (typeof session.exp !== 'number' || session.exp * 1000 < now) return null;
  return session;
}
