import { useEffect, useRef, useState, type RefObject } from 'react';
import { useApp, setApp, type StreamInfo, type VoiceMember } from '../state/store';
import { useSettings, updateSettings } from '../lib/settings';
import { leaveVoice, setDeafened, setFocus, setMuted } from '../lib/voice';
import { Avatar } from './Avatar';
import { openProfile } from './ProfileCard';
import { GoLiveButton } from './GoLiveButton';
import { NeonPicker } from './NeonPicker';
import { openUserMenu } from './Sidebar';
import { TrackVideo, popOut, useStreamStats } from './TrackVideo';
import {
  ChatIcon, EyeIcon, HeadphonesIcon, HeadphonesOffIcon, MaximizeIcon, MicIcon, MicOffIcon, MinimizeIcon,
  PaletteIcon, PhoneOffIcon, PopoutIcon, SignalIcon, SpeakerIcon, SpeakerOffIcon,
} from './Icons';

function Header() {
  const channels = useApp((s) => s.channels);
  const voiceChannel = useApp((s) => s.voiceChannel);
  const members = useApp((s) => s.members);
  const streams = useApp((s) => s.streams);
  const pings = useApp((s) => s.pings);
  const popover = useApp((s) => s.popover);
  const chatOpen = useApp((s) => s.chatOpen);
  const name = channels.find((c) => c.id === voiceChannel)?.name ?? '';
  const ping = pings.at(-1);
  return (
    <header className="head">
      <span className="ic"><SpeakerIcon /></span>
      <h1>{name}</h1>
      <span className="chip">{members.length} in voice</span>
      {streams.length > 0 && <span className="chip live">{streams.length} live</span>}
      <span className="spacer" />
      {ping !== undefined && (
        <button className="chip neon" title="Connection details" onClick={() => setApp({ popover: popover === 'connection' ? null : 'connection' })}>
          <SignalIcon size="xs" />
          {ping} ms
        </button>
      )}
      <button
        className="ib on"
        title="Neon color"
        aria-label="Neon color"
        style={popover === 'neon' ? { background: 'var(--neon-softer)' } : undefined}
        onClick={() => setApp({ popover: popover === 'neon' ? null : 'neon' })}
      >
        <PaletteIcon />
      </button>
      <button className={`ib${chatOpen ? ' on' : ''}`} title={chatOpen ? 'Hide chat' : 'Show chat'} aria-label={chatOpen ? 'Hide chat' : 'Show chat'} onClick={() => setApp({ chatOpen: !chatOpen })}>
        <ChatIcon />
      </button>
      {popover === 'neon' && <NeonPicker />}
    </header>
  );
}

/** Whether `ref` is the fullscreen element, and a toggle for it. */
function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement !== null && document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [ref]);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void ref.current?.requestFullscreen?.().catch(() => {});
  };
  return { full, toggle };
}

/** The stream's sound: click to mute, hover for a 0–200% slider. */
function StreamVolume({ id }: { id: string }) {
  const volume = useSettings((s) => s.streamVolumes[id] ?? 100);
  const [before, setBefore] = useState(100);
  const set = (v: number) => updateSettings({ streamVolumes: { ...useSettings.getState().streamVolumes, [id]: v } });
  const off = volume === 0;
  return (
    <span className="svol">
      <span className="glass svol-slider">
        <input
          type="range"
          min={0}
          max={200}
          value={volume}
          aria-label="Stream volume"
          onChange={(e) => set(Number(e.target.value))}
          onDoubleClick={() => set(100)}
        />
        <b>{volume}%</b>
      </span>
      <button
        className="ov glass"
        title={off ? 'Unmute stream sound' : 'Mute stream sound'}
        aria-label={off ? 'Unmute stream sound' : 'Mute stream sound'}
        onClick={() => {
          if (off) set(before || 100);
          else {
            setBefore(volume);
            set(0);
          }
        }}
      >
        {off ? <SpeakerOffIcon /> : <SpeakerIcon />}
      </button>
    </span>
  );
}

/** Who has this stream on screen; the names show on hover. */
function Viewers({ streamId }: { streamId: string }) {
  const users = useApp((s) => s.users);
  const viewers = users.filter((u) => u.watching === streamId && u.id !== streamId);
  return (
    <div className="glass ov-chip viewers" tabIndex={0} aria-label={`${viewers.length} watching`}>
      <EyeIcon size="xs" />
      {viewers.length}
      <div className="viewer-list" role="tooltip">
        <span className="label">{viewers.length ? 'Watching' : 'Nobody watching yet'}</span>
        {viewers.map((u) => (
          <span key={u.id} className="viewer">
            <Avatar id={u.id} name={u.name} color={u.color} size={20} />
            {u.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function FocusedStream({ stream }: { stream: StreamInfo }) {
  const ref = useRef<HTMLDivElement>(null);
  const { full, toggle: toggleFullscreen } = useFullscreen(ref);
  const showStats = useSettings((s) => s.showStreamStats);
  const stats = useStreamStats(stream.track, showStats);
  // "1440p60 · AV1 · 16 Mbps": the size and frame rate go top right, the rest on hover.
  const [qualityShort, ...qualityRest] = stream.quality.split(' · ');

  return (
    <div className="stage" ref={ref} onDoubleClick={toggleFullscreen}>
      {stream.track ? <TrackVideo track={stream.track} /> : <div className="empty-stage">Loading stream…</div>}
      <div className="ov-tl">
        <span className="live-pill big">LIVE</span>
        <span className="glass ov-label">{stream.isLocal ? `Your stream · ${stream.title}` : `${stream.name} · ${stream.title}`}</span>
      </div>
      <div className="ov-tr">
        {qualityShort && (
          <span className="glass ov-chip quality" title={qualityRest.length ? `${qualityShort} · ${qualityRest.join(' · ')}` : qualityShort}>
            {qualityShort}
          </span>
        )}
        <Viewers streamId={stream.id} />
      </div>
      {/* Fast clicks on these buttons shouldn't count as a double-click on the stream. */}
      <div className="ov-bottom ctl" onDoubleClick={(e) => e.stopPropagation()}>
        {(stats || stream.quality) && <span className="glass stats">{stats ?? stream.quality}</span>}
        <span className="spacer" />
        {!stream.isLocal && <StreamVolume id={stream.id} />}
        {stream.track && (
          <button className="ov glass" title="Pop out" aria-label="Pop out stream" onClick={() => popOut(stream.track!, stream.title)}>
            <PopoutIcon />
          </button>
        )}
        <button
          className="ov glass"
          title={full ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
          aria-label={full ? 'Exit fullscreen' : 'Fullscreen'}
          onClick={toggleFullscreen}
        >
          {full ? <MinimizeIcon /> : <MaximizeIcon />}
        </button>
      </div>
    </div>
  );
}

function StreamTile({ stream }: { stream: StreamInfo }) {
  const speaking = useApp((s) => s.members.find((m) => m.id === stream.id)?.speaking ?? false);
  return (
    <button
      className={`tile${speaking ? ' speaking' : ''}`}
      onClick={() => setFocus(stream.id)}
      onContextMenu={(e) => openUserMenu(e, stream.id)}
      aria-label={`Watch ${stream.name}'s stream`}
    >
      <TrackVideo track={stream.track} />
      <span className="glass name-tag"><span className="live-pill" style={{ fontSize: 9, padding: '1px 5px' }}>LIVE</span>{stream.isLocal ? 'You' : stream.name}</span>
      {stream.quality && <span className="glass tile-quality">{stream.quality.split(' · ')[0]}</span>}
      <span className="watch ctl">Watch</span>
    </button>
  );
}

function PersonTile({ m, big }: { m: VoiceMember; big?: boolean }) {
  if (big) {
    return (
      <div className={`ptile${m.speaking ? ' speaking' : ''}`} onClick={(e) => openProfile(e, m.id)} onContextMenu={(e) => openUserMenu(e, m.id)}>
        <Avatar id={m.id} name={m.name} color={m.color} size={84} />
        <span className="glass name-tag">
          {m.name}{m.isLocal ? ' (you)' : ''}
          {m.micMuted && <span className="flag"><MicOffIcon size="xs" label="Muted" /></span>}
        </span>
      </div>
    );
  }
  return (
    <div className={`tile${m.speaking ? ' speaking' : ''}`} onClick={(e) => openProfile(e, m.id)} onContextMenu={(e) => openUserMenu(e, m.id)}>
      <Avatar id={m.id} name={m.name} color={m.color} size={50} />
      <span className="glass name-tag">
        {m.isLocal ? 'You' : m.name}
        {m.micMuted && <span className="flag"><MicOffIcon size="xs" label="Muted" /></span>}
      </span>
    </div>
  );
}

function Dock() {
  const muted = useApp((s) => s.muted);
  const deafened = useApp((s) => s.deafened);
  const fullscreen = useApp((s) => s.fullscreen);
  const off = muted || deafened;
  return (
    <div className="dock-wrap">
      <div className="dock">
        <GoLiveButton variant="dock" />
        <span className="divider" />
        <button className={`dk${off ? ' bad' : ''}`} title={off ? 'Unmute' : 'Mute'} aria-label={off ? 'Unmute' : 'Mute'} onClick={() => setMuted(!off)}>
          {off ? <MicOffIcon /> : <MicIcon />}
        </button>
        <button className={`dk${deafened ? ' bad' : ''}`} title={deafened ? 'Undeafen' : 'Deafen'} aria-label={deafened ? 'Undeafen' : 'Deafen'} onClick={() => setDeafened(!deafened)}>
          {deafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
        </button>
        <button className="dk" title={fullscreen ? 'Show panels' : 'Theater mode'} aria-label={fullscreen ? 'Show panels' : 'Theater mode'} onClick={() => setApp({ fullscreen: !fullscreen })}>
          {fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
        </button>
        <button className="dk red" title="Leave voice" aria-label="Leave voice" onClick={() => void leaveVoice()}>
          <PhoneOffIcon />
        </button>
      </div>
    </div>
  );
}

export function VoiceView() {
  const status = useApp((s) => s.voiceStatus);
  const members = useApp((s) => s.members);
  const streams = useApp((s) => s.streams);
  const focus = useApp((s) => s.focus);
  const fullscreen = useApp((s) => s.fullscreen);
  const focused = streams.find((s) => s.id === focus) ?? null;

  return (
    <section className="chat" aria-label="Voice channel">
      {!fullscreen && <Header />}
      <div className="stagebox">
        {status === 'connecting' ? (
          <div className="connecting"><span className="pulse" style={{ color: 'var(--neon)' }} />Joining voice…</div>
        ) : focused ? (
          <>
            <FocusedStream stream={focused} />
            <div className="film">
              {streams.filter((s) => s.id !== focused.id).map((s) => <StreamTile key={s.id} stream={s} />)}
              {members.filter((m) => !m.streaming).map((m) => <PersonTile key={m.id} m={m} />)}
            </div>
          </>
        ) : (
          <div className="grid">
            {members.map((m) => <PersonTile key={m.id} m={m} big />)}
          </div>
        )}
        <Dock />
      </div>
    </section>
  );
}
