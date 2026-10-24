import type { MouseEvent } from 'react';
import { useApp, setApp } from '../state/store';
import { useSettings, updateSettings } from '../lib/settings';
import { serverUrl } from '../lib/api';
import { openTextChannel } from '../lib/actions';
import { joinVoice, leaveVoice, setDeafened, setFocus, setMuted } from '../lib/voice';
import { Avatar } from './Avatar';
import { openProfile } from './ProfileCard';
import { GoLiveButton } from './GoLiveButton';
import { STATUS_LABEL } from './StatusEditor';
import {
  GearIcon, HashIcon, HeadphonesIcon, HeadphonesOffIcon, LogoIcon, MicIcon, MicOffIcon,
  PhoneOffIcon, SpeakerIcon, SpeakerOffIcon, WaveIcon,
} from './Icons';

export function openUserMenu(e: MouseEvent, userId: string) {
  e.preventDefault();
  if (userId === useApp.getState().me?.id) return;
  const x = Math.max(8, Math.min(e.clientX, window.innerWidth - 268));
  const y = Math.max(8, Math.min(e.clientY, window.innerHeight - 330));
  setApp({ ctxMenu: { userId, x, y }, popover: null });
}

function Brand() {
  const serverName = useApp((s) => s.serverName);
  const online = useApp((s) => s.users.length);
  const status = useApp((s) => s.gatewayStatus);
  return (
    <div className="brand">
      <span className="logo"><LogoIcon size="l" /></span>
      <span className="meta">
        <span className="name">{serverName}</span>
        <span className="online">
          <i className={status === 'online' ? '' : 'off'} />
          {status === 'online' ? `${online} online` : status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </span>
      </span>
    </div>
  );
}

function VoiceChannels() {
  const channels = useApp((s) => s.channels);
  const users = useApp((s) => s.users);
  const voiceChannel = useApp((s) => s.voiceChannel);
  const members = useApp((s) => s.members);
  const status = useApp((s) => s.voiceStatus);
  const userMuted = useSettings((s) => s.userMuted);
  const mentionCounts = useApp((s) => s.mentionCounts);

  return (
    <>
      <div className="label">Voice</div>
      {channels.filter((c) => c.kind === 'voice').map((c) => {
        const joined = voiceChannel === c.id;
        const present = users.filter((u) => u.channel === c.id);
        // Inside your own channel, show LiveKit's view (speaking rings); elsewhere, presence.
        const list = joined && status === 'connected' && members.length ? members : null;
        const rows = list ?? present.map((u) => ({ id: u.id, name: u.name, color: u.color, speaking: false, micMuted: u.muted, streaming: Boolean(u.live), isLocal: false }));
        return (
          <div key={c.id} className={`vc${joined ? ' joined' : ''}${present.length ? ' has-people' : ''}`}>
            <button className="vc-head hv" onClick={() => void joinVoice(c.id)} aria-label={joined ? `${c.name}, connected` : `Join ${c.name}`}>
              <span className="ic"><SpeakerIcon size="s" /></span>
              <span className="n">{c.name}</span>
              {(mentionCounts[c.id] ?? 0) > 0 && <span className="ping-count">{mentionCounts[c.id]}</span>}
            </button>
            {rows.length > 0 && (
              <div className="vc-members">
                {rows.map((m) => {
                  const pres = users.find((u) => u.id === m.id);
                  const deaf = Boolean(pres?.deafened);
                  return (
                    <button
                      key={m.id}
                      className={`member hv${m.speaking ? ' speaking' : ''}`}
                      onClick={(e) => openProfile(e, m.id)}
                      onContextMenu={(e) => openUserMenu(e, m.id)}
                    >
                      <Avatar id={m.id} name={m.name} color={m.color} size={26} speaking={m.speaking} />
                      <span className="n">{m.name}{m.isLocal ? ' (you)' : ''}</span>
                      {m.speaking && <span className="eq" aria-hidden="true"><span /><span /><span /></span>}
                      {userMuted[m.id] && <span className="flag"><SpeakerOffIcon size="xs" label="Muted by you" /></span>}
                      {m.micMuted && !deaf && <span className="flag"><MicOffIcon size="xs" label="Muted" /></span>}
                      {deaf && <span className="flag"><HeadphonesOffIcon size="xs" label="Deafened" /></span>}
                      {m.streaming && (
                        <span
                          className="live-pill"
                          title={joined ? 'Watch stream' : `Live in ${c.name}`}
                          onClick={(e) => {
                            // Only streams in your own channel can be watched.
                            if (!joined) return;
                            e.stopPropagation();
                            setFocus(m.id);
                          }}
                        >
                          LIVE
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function TextChannels() {
  const channels = useApp((s) => s.channels);
  const view = useApp((s) => s.view);
  const textChannel = useApp((s) => s.textChannel);
  const messages = useApp((s) => s.messages);
  const me = useApp((s) => s.me);
  const lastRead = useSettings((s) => s.lastRead);
  const mentionCounts = useApp((s) => s.mentionCounts);

  return (
    <>
      <div className="label gap">Text</div>
      {channels.filter((c) => c.kind === 'text').map((c) => {
        const active = view === 'text' && textChannel === c.id;
        const last = messages[c.id]?.at(-1);
        const unread = !active && last !== undefined && last.userId !== me?.id && last.id > (lastRead[c.id] ?? 0);
        const pings = mentionCounts[c.id] ?? 0;
        return (
          <button key={c.id} className={`tc hv${active ? ' active' : ''}${unread ? ' unread' : ''}`} onClick={() => openTextChannel(c.id)}>
            <span className="ic"><HashIcon size="s" /></span>
            <span className="n">{c.name}</span>
            {pings > 0 ? (
              <span className="ping-count" aria-label={`${pings} mention${pings === 1 ? '' : 's'}`}>{pings}</span>
            ) : (
              unread && <span className="unread-dot" aria-label="Unread messages" />
            )}
          </button>
        );
      })}
    </>
  );
}

function ConnectionPopover() {
  const pings = useApp((s) => s.pings);
  const noise = useSettings((s) => s.noise);
  const fec = useSettings((s) => s.packetLossProtection);
  const max = Math.max(60, ...pings);
  const avg = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null;
  let host = '';
  try {
    host = new URL(serverUrl()).host;
  } catch {
    host = serverUrl();
  }
  return (
    <>
      <button className="pop-backdrop" aria-label="Close connection details" onClick={() => setApp({ popover: null })} />
      <div className="pop conn-pop" role="dialog" aria-label="Connection details">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="disp" style={{ fontWeight: 700 }}>Connection</span>
          <span className="disp" style={{ color: 'var(--neon)', fontWeight: 700, textShadow: 'var(--glow-text)' }}>{avg ?? '–'} ms</span>
        </div>
        <div className="bars" aria-hidden="true">
          {pings.slice(-16).map((p, i, arr) => (
            <span key={i} style={{ height: `${Math.max(8, (p / max) * 100)}%`, opacity: 0.35 + (0.65 * (i + 1)) / arr.length }} />
          ))}
        </div>
        <div className="kv">
          <span>Server</span><span title={host}>{host}</span>
          <span>Voice</span><span>Opus 64 kbps</span>
          <span>Loss protection</span><span>{fec ? 'FEC + RED' : 'Off'}</span>
          <span>Noise filter</span><span>{noise === 'off' ? 'Off' : noise === 'high' ? 'GTCRN' : 'RNNoise'}</span>
        </div>
      </div>
    </>
  );
}

function StatusCard() {
  const voiceChannel = useApp((s) => s.voiceChannel);
  const status = useApp((s) => s.voiceStatus);
  const channels = useApp((s) => s.channels);
  const pings = useApp((s) => s.pings);
  const popover = useApp((s) => s.popover);
  const noise = useSettings((s) => s.noise);
  if (!voiceChannel) return null;
  const name = channels.find((c) => c.id === voiceChannel)?.name ?? voiceChannel;
  const ping = pings.at(-1);
  const label =
    status === 'connected' ? `Connected${ping ? ` · ${ping} ms` : ''}` : status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';

  return (
    <div className="status-card">
      {popover === 'connection' && <ConnectionPopover />}
      <div className="row">
        <button className="conn" onClick={() => setApp({ popover: popover === 'connection' ? null : 'connection' })}>
          <b className={status === 'connected' ? '' : 'warn'}><span className="pulse" />{label}</b>
          <small>{name} · voice</small>
        </button>
        <button
          className={`ib${noise !== 'off' ? ' on' : ''}`}
          title={noise !== 'off' ? 'Noise suppression on' : 'Noise suppression off'}
          aria-label={noise !== 'off' ? 'Turn noise suppression off' : 'Turn noise suppression on'}
          onClick={() => updateSettings({ noise: noise === 'off' ? 'standard' : 'off' })}
        >
          <WaveIcon />
        </button>
        <button className="ib bad" title="Leave voice" aria-label="Leave voice" onClick={() => void leaveVoice()}>
          <PhoneOffIcon />
        </button>
      </div>
      <GoLiveButton variant="side" />
      <StreamHealthLine />
    </div>
  );
}

/** While you're live: the quality you're really sending, and why if it's lower than you chose. */
function StreamHealthLine() {
  const h = useApp((s) => s.streamHealth);
  const live = useApp((s) => Boolean(s.myLive));
  if (!live || !h) return null;
  const lowered = h.tier !== h.chosen;
  const advice =
    h.reason === 'pc'
      ? 'Your PC is working hard (the game, recording or another stream). Close other apps or pick a lower quality.'
      : 'Something else is using your upload (another stream, a download, cloud sync). It goes back up when there is room.';
  return (
    <div className={`stream-health ${lowered ? 'low' : 'ok'}`} title={lowered ? advice : `Sending ${h.tier} as chosen.`}>
      <i />
      {lowered ? (
        <span><b>{h.tier}</b> for now · {h.reason === 'pc' ? 'your PC is busy' : 'your upload is busy'}</span>
      ) : (
        <span>Sending <b>{h.tier}</b> · all good</span>
      )}
    </div>
  );
}

function UserCard() {
  const me = useApp((s) => s.me);
  const muted = useApp((s) => s.muted);
  const deafened = useApp((s) => s.deafened);
  const voiceChannel = useApp((s) => s.voiceChannel);
  const speaking = useApp((s) => s.members.some((m) => m.isLocal && m.speaking));
  const chosen = useSettings((s) => s.status);
  const idle = useApp((s) => s.idle);
  const customSetting = useSettings((s) => s.customStatus);
  if (!me) return null;
  const status = chosen === 'online' && idle ? 'idle' : chosen;
  const custom = customSetting && (customSetting.until === null || customSetting.until > Date.now()) ? customSetting : null;
  const off = muted || deafened;
  return (
    <div className="user-card">
      <button className="me hv" aria-label="Your profile" onClick={(e) => openProfile(e, me.id)}>
        <Avatar id={me.id} name={me.name} color={me.color} size={36} speaking={speaking} status={status} />
        <span className="who">
          <b>{me.name}</b>
          <small>
            {deafened ? 'Deafened' : muted ? 'Muted' : custom ? `${custom.emoji} ${custom.text}`.trim() : voiceChannel ? 'In voice' : STATUS_LABEL[status]}
          </small>
        </span>
      </button>
      <button className={`ib${off ? ' bad' : ''}`} title={off ? 'Unmute' : 'Mute'} aria-label={off ? 'Unmute' : 'Mute'} onClick={() => setMuted(!off)}>
        {off ? <MicOffIcon /> : <MicIcon />}
      </button>
      <button className={`ib${deafened ? ' bad' : ''}`} title={deafened ? 'Undeafen' : 'Deafen'} aria-label={deafened ? 'Undeafen' : 'Deafen'} onClick={() => setDeafened(!deafened)}>
        {deafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
      </button>
      <button className="ib" title="Settings" aria-label="Settings" onClick={() => setApp({ modal: 'settings', settingsSection: 'voice', popover: null })}>
        <GearIcon />
      </button>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="side panel" aria-label="Channels">
      <Brand />
      <div className="side-scroll scroll">
        <VoiceChannels />
        <TextChannels />
      </div>
      <StatusCard />
      <UserCard />
    </aside>
  );
}
