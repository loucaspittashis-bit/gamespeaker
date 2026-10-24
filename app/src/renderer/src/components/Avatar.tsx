import { useState } from 'react';
import { mediaUrl, type Profile } from '../lib/api';
import { useApp } from '../state/store';
import { Frame, frameById } from './frames';

/** What an avatar looks like; anything left out comes from the user's saved profile. */
export type AvatarLook = Partial<Pick<Profile, 'avatar' | 'frame' | 'frameColor'>> & { src?: string | null };

type Props = {
  name: string;
  color: string;
  size: 20 | 26 | 32 | 34 | 36 | 40 | 50 | 64 | 84 | 96;
  speaking?: boolean;
  /** Show a status dot: true means online. */
  status?: boolean | 'online' | 'idle' | 'dnd';
  /** Whose avatar this is, to show their photo and frame. */
  id?: string;
  look?: AvatarLook;
  noFrame?: boolean;
};

export function frameColorFor(frame: string, frameColor: string | null | undefined, avatarColor: string): string {
  return frameColor ?? frameById(frame)?.defaultColor ?? avatarColor;
}

export function Avatar({ name, color, size, speaking, status, id, look, noFrame }: Props) {
  const saved = useApp((s) => (id ? s.profiles[id] : undefined));
  const p: AvatarLook = { ...saved, ...look };
  const src = p.src !== undefined ? p.src : p.avatar ? mediaUrl(p.avatar) : null;
  const [failed, setFailed] = useState<string | null>(null);
  const showPic = src && failed !== src;
  // Frames need room to read; the tiny stacked avatars skip them.
  const frame = !noFrame && size >= 26 && p.frame && frameById(p.frame) ? p.frame : null;

  const el = (
    <span className={`av sz${size}${speaking ? ' speaking' : ''}${showPic ? ' pic' : ''}`} style={{ background: color }} aria-hidden="true">
      {showPic ? (
        <img src={src} alt="" draggable={false} decoding="async" onError={() => setFailed(src)} />
      ) : (
        (name.trim().charAt(0) || '?').toUpperCase()
      )}
    </span>
  );
  if (!status && !frame) return el;
  return (
    <span className="av-wrap">
      {el}
      {frame && <Frame id={frame} color={frameColorFor(frame, p.frameColor, color)} size={size} />}
      {status && <span className={`status-dot ${status === true ? 'online' : status}`} />}
    </span>
  );
}
