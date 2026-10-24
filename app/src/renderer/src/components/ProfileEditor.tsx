import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { MAX_BIO_CHARS, MAX_UPLOAD_BYTES } from '../lib/api';
import { editProfile, logout, updateProfile, uploadProfileImage } from '../lib/actions';
import { AVATAR_COLORS } from '../lib/settings';
import { toast, useApp } from '../state/store';
import { Avatar } from './Avatar';
import { BONE, FRAMES } from './frames';
import { ProfileCardView } from './ProfileCard';

type Kind = 'avatar' | 'banner';

// Output sizes: avatars show at up to 96px (192 on sharp screens), the card banner at 300×120.
const CROP = {
  avatar: { w: 280, h: 280, outW: 256, outH: 256, radius: 0.29 },
  banner: { w: 420, h: 168, outW: 900, outH: 360, radius: 0.04 },
} as const;

const FRAME_COLORS = [BONE, '#ff3b4f', '#ff7a1a', '#ffc53d', '#6ee7c8', '#2de2ff', '#8cc8ff', '#b3a6ff', '#ff2bd6', '#ffffff'];
const BANNER_COLORS = ['#2de2ff', '#b3a6ff', '#ff2bd6', '#ff3b4f', '#ff7a1a', '#ffc53d', '#6ee7c8', '#3a3f49'];

const sizeText = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

// ---------------- Crop ----------------

/** Pan and zoom a picture inside the avatar or banner shape, then save just that part. */
function CropDialog({ kind, src, onClose }: { kind: Kind; src: string; onClose: () => void }) {
  const box = CROP[kind];
  const imgRef = useRef<HTMLImageElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // Scale that makes the picture just cover the frame at zoom 1.
  const cover = nat ? Math.max(box.w / nat.w, box.h / nat.h) : 1;
  const scale = cover * zoom;
  const shown = nat ? { w: nat.w * scale, h: nat.h * scale } : { w: 0, h: 0 };
  const clamp = (x: number, y: number) => ({
    x: Math.min(0, Math.max(box.w - shown.w, x)),
    y: Math.min(0, Math.max(box.h - shown.h, y)),
  });

  // Keep the picture centred on the same spot when zooming.
  const zoomTo = (next: number) => {
    const z = Math.min(4, Math.max(1, next));
    const cx = (box.w / 2 - pos.x) / scale;
    const cy = (box.h / 2 - pos.y) / scale;
    const s = cover * z;
    setZoom(z);
    setPos({
      x: Math.min(0, Math.max(box.w - (nat?.w ?? 0) * s, box.w / 2 - cx * s)),
      y: Math.min(0, Math.max(box.h - (nat?.h ?? 0) * s, box.h / 2 - cy * s)),
    });
  };

  const onLoad = () => {
    const img = imgRef.current!;
    const n = { w: img.naturalWidth, h: img.naturalHeight };
    const c = Math.max(box.w / n.w, box.h / n.h);
    setNat(n);
    setPos({ x: (box.w - n.w * c) / 2, y: (box.h - n.h * c) / 2 });
  };

  const onDown = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ...pos };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (d) setPos(clamp(d.x + e.clientX - d.px, d.y + e.clientY - d.py));
  };

  const save = async () => {
    if (!nat || !imgRef.current) return;
    setBusy(true);
    const canvas = document.createElement('canvas');
    canvas.width = box.outW;
    canvas.height = box.outH;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgRef.current, -pos.x / scale, -pos.y / scale, box.w / scale, box.h / scale, 0, 0, box.outW, box.outH);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    const ok = blob ? await uploadProfileImage(kind, blob) : false;
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <div className="crop-back" role="dialog" aria-modal="true" aria-label={kind === 'avatar' ? 'Crop your photo' : 'Crop your banner'}>
      <div className="crop">
        <h2>{kind === 'avatar' ? 'Position your photo' : 'Position your banner'}</h2>
        <p>Drag to move. Scroll or use the slider to zoom.</p>
        <div
          className="crop-view"
          style={{ width: box.w, height: box.h, borderRadius: box.w * box.radius }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => (drag.current = null)}
          onWheel={(e) => zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
        >
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable={false}
            onLoad={onLoad}
            style={{ width: shown.w || undefined, height: shown.h || undefined, transform: `translate(${pos.x}px, ${pos.y}px)`, opacity: nat ? 1 : 0 }}
          />
        </div>
        <input aria-label="Zoom" type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} />
        <div className="adm-actions" style={{ justifyContent: 'flex-end' }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-neon" disabled={!nat || busy} onClick={() => void save()}>{busy ? 'Uploading…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Editor ----------------

function Swatches({ colors, value, onPick, auto }: { colors: string[]; value: string | null; onPick: (c: string | null) => void; auto?: boolean }) {
  const timer = useRef<number | null>(null);
  const [custom, setCustom] = useState(value ?? '#ffffff');
  useEffect(() => setCustom(value ?? '#ffffff'), [value]);
  return (
    <div className="pe-swatches">
      {auto && (
        <button className="pe-auto" aria-pressed={value === null} onClick={() => onPick(null)}>Auto</button>
      )}
      {colors.map((c) => (
        <button key={c} className="swatch" style={{ width: 28, height: 28, background: c, '--sw': c } as CSSProperties} aria-label={c} aria-pressed={value === c} onClick={() => onPick(c)} />
      ))}
      <input
        className="color-input"
        type="color"
        aria-label="Custom color"
        value={custom}
        style={{ width: 40, height: 28 }}
        onChange={(e) => {
          const c = e.target.value;
          setCustom(c);
          // The picker fires on every drag step; save once it settles.
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => onPick(c), 400);
        }}
      />
    </div>
  );
}

export function ProfileSettings() {
  const me = useApp((s) => s.me);
  const profile = useApp((s) => (me ? s.profiles[me.id] : undefined));
  const [name, setName] = useState(me?.name ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [crop, setCrop] = useState<{ kind: Kind; src: string } | null>(null);
  const [uploading, setUploading] = useState<Kind | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickKind = useRef<Kind>('avatar');

  useEffect(() => setBio(profile?.bio ?? ''), [profile?.bio]);
  useEffect(() => {
    if (!crop) return;
    return () => URL.revokeObjectURL(crop.src);
  }, [crop]);

  if (!me) return null;
  const color = me.color;

  const pick = (kind: Kind) => {
    pickKind.current = kind;
    fileRef.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const kind = pickKind.current;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      toast('Use a PNG, JPG, WebP or GIF picture', 'warn');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES[kind]) {
      toast(`That picture is too big. The limit is ${sizeText(MAX_UPLOAD_BYTES[kind])}.`, 'warn');
      return;
    }
    // GIFs go up as they are so they keep moving; everything else is cropped first.
    if (file.type === 'image/gif') {
      setUploading(kind);
      await uploadProfileImage(kind, file);
      setUploading(null);
    } else {
      setCrop({ kind, src: URL.createObjectURL(file) });
    }
  };

  const saveName = () => {
    const n = name.trim();
    if (n && n !== me.name) void updateProfile({ name: n });
  };
  const saveBio = () => {
    if (bio.trim() !== (profile?.bio ?? '')) void editProfile({ bio });
  };

  return (
    <>
      <h1>My profile</h1>
      <p className="lead">Your photo, frame and card. Friends see changes straight away.</p>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="pe">
        <div className="pe-form">
          <div className="card">
            <span className="label">Photo</span>
            <div className="pe-photo">
              <Avatar id={me.id} name={name || '?'} color={color} size={84} />
              <div>
                <div className="adm-actions">
                  <button className="btn-soft" disabled={uploading === 'avatar'} onClick={() => pick('avatar')}>
                    {uploading === 'avatar' ? 'Uploading…' : profile?.avatar ? 'Change photo' : 'Upload photo'}
                  </button>
                  {profile?.avatar && <button className="btn-ghost sm" onClick={() => void editProfile({ avatar: null })}>Remove</button>}
                </div>
                <div className="adm-hint">PNG, JPG, WebP or GIF up to {sizeText(MAX_UPLOAD_BYTES.avatar)}. GIFs stay animated.</div>
              </div>
            </div>
            <div className="hr" style={{ margin: '16px 0 14px' }} />
            <label className="adm-field-label" htmlFor="nick">Nickname</label>
            <input
              id="nick"
              className="field"
              value={name}
              maxLength={32}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === 'Enter' && saveName()}
            />
            <div className="adm-field-label" style={{ marginTop: 14 }}>Color behind your initial</div>
            <div className="pe-swatches">
              {AVATAR_COLORS.map((c, i) => (
                <button
                  key={c}
                  className="swatch"
                  style={{ width: 28, height: 28, background: c, '--sw': c } as CSSProperties}
                  aria-label={`Avatar color ${i + 1}`}
                  aria-pressed={c === color}
                  onClick={() => void updateProfile({ color: c })}
                />
              ))}
            </div>
          </div>

          <div className="card">
            <span className="label">Frame</span>
            <div className="pe-frames">
              <button aria-pressed={!profile?.frame} onClick={() => void editProfile({ frame: null })}>
                <Avatar id={me.id} look={{ frame: null }} name={name || '?'} color={color} size={50} />
                <span>None</span>
              </button>
              {FRAMES.map((f) => (
                <button key={f.id} aria-pressed={profile?.frame === f.id} onClick={() => void editProfile({ frame: f.id })}>
                  <Avatar id={me.id} look={{ frame: f.id }} name={name || '?'} color={color} size={50} />
                  <span>{f.name}</span>
                </button>
              ))}
            </div>
            {profile?.frame && (
              <>
                <div className="adm-field-label" style={{ marginTop: 16 }}>Frame color</div>
                <Swatches auto colors={FRAME_COLORS} value={profile.frameColor} onPick={(c) => void editProfile({ frameColor: c })} />
              </>
            )}
          </div>

          <div className="card">
            <span className="label">Banner</span>
            <div className="adm-actions">
              <button className="btn-soft" disabled={uploading === 'banner'} onClick={() => pick('banner')}>
                {uploading === 'banner' ? 'Uploading…' : profile?.banner ? 'Change banner' : 'Upload banner'}
              </button>
              {profile?.banner && <button className="btn-ghost sm" onClick={() => void editProfile({ banner: null })}>Remove</button>}
            </div>
            <div className="adm-hint">The strip across the top of your card. PNG, JPG, WebP or GIF up to {sizeText(MAX_UPLOAD_BYTES.banner)}.</div>
            <div className="adm-field-label" style={{ marginTop: 16 }}>{profile?.banner ? 'Color while it loads' : 'Banner color'}</div>
            <Swatches auto colors={BANNER_COLORS} value={profile?.bannerColor ?? null} onPick={(c) => void editProfile({ bannerColor: c })} />
          </div>

          <div className="card">
            <label className="label" htmlFor="bio">About me</label>
            <textarea
              id="bio"
              className="field pe-bio"
              rows={4}
              maxLength={MAX_BIO_CHARS}
              placeholder="Main games, ranks, what you're playing this week…"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              onBlur={saveBio}
            />
            <div className="adm-hint" style={{ textAlign: 'right' }}>{bio.length}/{MAX_BIO_CHARS}</div>
          </div>
          <button className="btn-plain" style={{ color: 'var(--red)' }} onClick={() => void logout()}>Sign out</button>
        </div>

        <div className="pe-preview">
          <div className="label">Preview</div>
          <ProfileCardView userId={me.id} name={name || me.name} color={color} look={{ bio }} />
        </div>
      </div>
      {crop && (
        <CropDialog
          kind={crop.kind}
          src={crop.src}
          onClose={() => setCrop(null)}
        />
      )}
    </>
  );
}
