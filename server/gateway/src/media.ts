import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';

export type ImageExt = 'png' | 'jpg' | 'webp' | 'gif';

export const IMAGE_TYPES: Record<ImageExt, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** Largest width or height we store. Bigger images can stall or crash the app when decoded. */
export const MAX_IMAGE_SIDE = 4096;

export const MEDIA_NAME = /^[a-f0-9]{32}\.(png|jpg|webp|gif)$/;

export type ImageInfo = { ext: ImageExt; width: number; height: number };

function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    // Start-of-frame markers carry the size (C4, C8 and CC are other tables).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2; // markers without a length
      continue;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function webpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  return null;
}

/**
 * Identifies an image by its first bytes, never by the name or content type the
 * client sent, and reads its size without decoding it. SVG is not accepted: it
 * can carry scripts.
 */
export function sniffImage(buf: Buffer): ImageInfo | null {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    return { ext: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  const head = buf.toString('ascii', 0, 6);
  if (head === 'GIF87a' || head === 'GIF89a') {
    return { ext: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const size = webpSize(buf);
    return size && { ext: 'webp', ...size };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const size = jpegSize(buf);
    return size && { ext: 'jpg', ...size };
  }
  return null;
}

// Uploaded pictures, stored once each under a name made from their contents.
export class MediaStore {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  save(buf: Buffer, ext: ImageExt): string {
    const name = `${createHash('sha256').update(buf).digest('hex').slice(0, 32)}.${ext}`;
    const file = join(this.dir, name);
    if (!existsSync(file)) {
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, buf);
      renameSync(tmp, file);
    }
    return name;
  }

  has(name: string): boolean {
    return MEDIA_NAME.test(name) && existsSync(join(this.dir, name));
  }

  remove(name: string): void {
    if (!MEDIA_NAME.test(name)) return;
    try {
      unlinkSync(join(this.dir, name));
    } catch {
      // already gone
    }
  }

  /** Streams a stored picture. Returns false if there is no such file. */
  serve(name: string, res: ServerResponse): boolean {
    if (!MEDIA_NAME.test(name)) return false;
    const file = join(this.dir, name);
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      return false;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', IMAGE_TYPES[name.split('.').pop() as ImageExt]);
    res.setHeader('Content-Length', String(size));
    // The name is the content's hash, so it never changes.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
    return true;
  }
}
