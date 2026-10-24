import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { mediaUrl } from '../lib/api';
import { setFocus } from '../lib/voice';
import { app, setApp, useApp } from '../state/store';
import { Avatar, type AvatarLook } from './Avatar';
import { EyeIcon, GamepadIcon } from './Icons';
import { STATUS_LABEL, StatusEditor } from './StatusEditor';

/** Opens someone's profile card next to the element that was clicked. */
export function openProfile(e: MouseEvent, userId: string, fallback?: { name: string; color: string }): void {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  setApp({ profileCard: { userId, left: r.left, right: r.right, top: r.top, ...fallback }, ctxMenu: null, popover: null });
}

type CardProps = {
  userId: string;
  name: string;
  color: string;
  /** Overrides for the settings preview, before anything is saved. */
  look?: AvatarLook & { banner?: string | null; bannerSrc?: string | null; bannerColor?: string | null; bio?: string };
  children?: ReactNode;
};

export function ProfileCardView({ userId, name, color, look, children }: CardProps) {
  const saved = useApp((s) => s.profiles[userId]);
  const pres = useApp((s) => s.users.find((u) => u.id === userId));
  const channels = useApp((s) => s.channels);
  const isMe = useApp((s) => s.me?.id === userId);
  const p = { ...saved, ...look };
  const banner = p.bannerSrc ?? (p.banner ? mediaUrl(p.banner) : null);
  const where = channels.find((c) => c.id === pres?.channel)?.name;
  const st = pres?.status ?? 'online';
  const status = !pres ? 'Offline' : where ? `In ${where}` : STATUS_LABEL[st];

  return (
    <div className="pcard" style={{ '--bc': p.bannerColor ?? color } as CSSProperties}>
      <div className="pc-banner">{banner && <img src={banner} alt="" draggable={false} />}</div>
      <div className="pc-av">
        <Avatar id={userId} look={look} name={name} color={color} size={84} />
      </div>
      <div className="pc-body">
        <h3>{name}</h3>
        {pres?.custom && <div className="pc-custom">{`${pres.custom.emoji} ${pres.custom.text}`.trim()}</div>}
        <div className="pc-status"><i className={pres ? `status-dot ${st}` : 'off'} />{status}{pres && where && st !== 'online' ? ` · ${STATUS_LABEL[st]}` : ''}</div>
        {pres?.playing && !pres.live && (
          <div className="pc-playing"><GamepadIcon size="s" /><span>Playing <b>{pres.playing}</b></span></div>
        )}
        {pres?.live && (
          <div className="pc-live"><span className="live-pill">LIVE</span><span>{pres.live.title}</span></div>
        )}
        {(p.bio || isMe) && (
          <div className="pc-about">
            <span className="label">About me</span>
            {p.bio ? <p>{p.bio}</p> : <p className="empty">Nothing here yet.</p>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function ProfilePopover() {
  const card = useApp((s) => s.profileCard);
  const pres = useApp((s) => (card ? s.users.find((u) => u.id === card.userId) : undefined));
  const member = useApp((s) => (card ? s.members.find((m) => m.id === card.userId) : undefined));
  const isMe = useApp((s) => Boolean(card && s.me?.id === card.userId));
  const watchable = useApp((s) => Boolean(card && s.streams.some((x) => x.id === card.userId)));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    setPos(null);
    if (!card || !ref.current) return;
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    // Beside the thing that was clicked: to its right if there's room, else to its left.
    const left = card.right + 10 + w <= window.innerWidth - 12 ? card.right + 10 : Math.max(12, card.left - 10 - w);
    const top = Math.min(Math.max(12, card.top - 24), window.innerHeight - h - 12);
    setPos({ left, top });
  }, [card]);

  if (!card) return null;
  const close = () => setApp({ profileCard: null });
  const name = pres?.name ?? member?.name ?? card.name ?? 'friend';
  const color = pres?.color ?? member?.color ?? card.color ?? '#8b919d';

  return (
    <>
      <button className="pop-backdrop" style={{ zIndex: 40 }} aria-label="Close profile" onClick={close} />
      <div
        ref={ref}
        className="pc-pop"
        role="dialog"
        aria-label={`${name}'s profile`}
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      >
        <ProfileCardView userId={card.userId} name={name} color={color}>
          {isMe ? (
            <>
              <StatusEditor />
              <button className="btn-plain pc-action" onClick={() => setApp({ profileCard: null, modal: 'settings', settingsSection: 'profile' })}>
                Edit profile
              </button>
            </>
          ) : (
            watchable && (
              <button
                className="btn-soft pc-action"
                onClick={() => {
                  setFocus(card.userId);
                  setApp({ view: 'voice', profileCard: null });
                }}
              >
                <EyeIcon size="s" />
                Watch stream
              </button>
            )
          )}
        </ProfileCardView>
      </div>
    </>
  );
}

/** Closes the card if it's open; for Escape. */
export const closeProfile = (): boolean => {
  if (!app().profileCard) return false;
  setApp({ profileCard: null });
  return true;
};
