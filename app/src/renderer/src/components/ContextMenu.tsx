import { useApp, setApp, toast } from '../state/store';
import { useSettings, updateSettings } from '../lib/settings';
import { setFocus } from '../lib/voice';
import { Avatar } from './Avatar';
import { openProfile } from './ProfileCard';
import { CheckIcon, EyeIcon } from './Icons';

export function ContextMenu() {
  const ctx = useApp((s) => s.ctxMenu);
  const users = useApp((s) => s.users);
  const members = useApp((s) => s.members);
  const streams = useApp((s) => s.streams);
  const channels = useApp((s) => s.channels);
  const volume = useSettings((s) => (ctx ? s.userVolumes[ctx.userId] ?? 100 : 100));
  const muted = useSettings((s) => (ctx ? Boolean(s.userMuted[ctx.userId]) : false));
  const streamVolume = useSettings((s) => (ctx ? s.streamVolumes[ctx.userId] ?? 100 : 100));
  if (!ctx) return null;

  const id = ctx.userId;
  const pres = users.find((u) => u.id === id);
  const member = members.find((m) => m.id === id);
  const name = pres?.name ?? member?.name ?? 'friend';
  const color = pres?.color ?? member?.color ?? '#8b919d';
  const where = channels.find((c) => c.id === pres?.channel)?.name;
  const streaming = streams.some((s) => s.id === id);
  const close = () => setApp({ ctxMenu: null });

  return (
    <>
      <button className="pop-backdrop" style={{ zIndex: 40 }} aria-label="Close menu" onClick={close} onContextMenu={(e) => { e.preventDefault(); close(); }} />
      <div className="ctx" role="menu" aria-label={`${name} options`} style={{ left: ctx.x, top: ctx.y }}>
        <button className="who hv" title="View profile" onClick={(e) => openProfile(e, id, { name, color })}>
          <Avatar id={id} name={name} color={color} size={32} />
          <span>
            <b>{name}</b>
            <small>{where ? `In ${where}` : 'Online'}</small>
          </span>
        </button>
        <div className="vol">
          <label className="label" htmlFor="user-vol"><span>Volume</span><span>{volume}%</span></label>
          <input
            id="user-vol"
            type="range"
            min={0}
            max={200}
            step={1}
            value={volume}
            onChange={(e) => updateSettings({ userVolumes: { ...useSettings.getState().userVolumes, [id]: Number(e.target.value) } })}
            onDoubleClick={() => updateSettings({ userVolumes: { ...useSettings.getState().userVolumes, [id]: 100 } })}
          />
        </div>
        <button className="mi" role="menuitemcheckbox" aria-checked={muted} onClick={() => updateSettings({ userMuted: { ...useSettings.getState().userMuted, [id]: !muted } })}>
          <span>Mute for me</span>
          <span className={`check${muted ? ' on' : ''}`}>{muted && <CheckIcon size="xs" />}</span>
        </button>
        {streaming && (
          <>
            <button className="mi" role="menuitem" onClick={() => { setFocus(id); setApp({ view: 'voice' }); close(); }}>
              <span>Watch stream</span>
              <EyeIcon size="s" />
            </button>
            <button
              className="mi"
              role="menuitemcheckbox"
              aria-checked={streamVolume === 0}
              onClick={() => updateSettings({ streamVolumes: { ...useSettings.getState().streamVolumes, [id]: streamVolume === 0 ? 100 : 0 } })}
            >
              <span>Mute stream sound</span>
              <span className={`check${streamVolume === 0 ? ' on' : ''}`}>{streamVolume === 0 && <CheckIcon size="xs" />}</span>
            </button>
          </>
        )}
        <div className="hr" />
        <button
          className="mi"
          role="menuitem"
          onClick={() => {
            void navigator.clipboard?.writeText(name).then(() => toast(`Copied "${name}"`)).catch(() => {});
            close();
          }}
        >
          <span>Copy name</span>
        </button>
      </div>
    </>
  );
}
