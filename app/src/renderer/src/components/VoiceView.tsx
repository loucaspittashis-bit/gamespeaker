import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useApp, setApp, type StreamInfo, type VoiceMember } from '../state/store';
import { useSettings, updateSettings } from '../lib/settings';
import { leaveVoice, setDeafened, setFocus, setMuted, stopWatching, watchSideBySide } from '../lib/voice';
import { Avatar } from './Avatar';
import { openProfile } from './ProfileCard';
import { GoLiveButton } from './GoLiveButton';
import { NeonPicker } from './NeonPicker';
import { openUserMenu } from './Sidebar';
import { TrackVideo, popOut, useStreamStats } from './TrackVideo';
import {
  ChatIcon, CloseIcon, EyeIcon, PanelsIcon, SplitIcon, SplitRowsIcon, SwapIcon, HeadphonesIcon, HeadphonesOffIcon, MaximizeIcon, MicIcon, MicOffIcon, MinimizeIcon,
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
  const me = useApp((s) => s.me?.id);
  const messages = useApp((s) => (s.voiceChannel ? s.messages[s.voiceChannel] : undefined));
  const lastRead = useSettings((s) => (voiceChannel ? s.lastRead[voiceChannel] ?? 0 : 0));
  const unread = chatOpen ? 0 : (messages ?? []).filter((m) => m.id > lastRead && m.userId !== me).length;
  const name = channels.find((c) => c.id === voiceChannel)?.name ?? '';
  const ping = pings.at(-1);
  return (
    <header className="head voice-head">
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
      {chatOpen ? (
        <button className="ib on" title="Hide chat" aria-label="Hide chat" onClick={() => setApp({ chatOpen: false })}>
          <ChatIcon />
        </button>
      ) : (
        // Closed chat gets a real button, with how many messages you've missed.
        <button className="btn-soft chat-open" onClick={() => setApp({ chatOpen: true })}>
          <ChatIcon size="s" />
          Chat
          {unread > 0 && <span className="ping-count">{unread > 99 ? '99+' : unread}</span>}
        </button>
      )}
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
  const viewers = users.filter((u) => (u.watching === streamId || u.watching2 === streamId) && u.id !== streamId);
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

/** In split view, fullscreen means both streams together. */
const SplitFullscreen = createContext<{ full: boolean; toggle: () => void } | null>(null);

function FocusedStream({ stream }: { stream: StreamInfo }) {
  const ref = useRef<HTMLDivElement>(null);
  const own = useFullscreen(ref);
  const { full, toggle: toggleFullscreen } = useContext(SplitFullscreen) ?? own;
  const showStats = useSettings((s) => s.showStreamStats);
  const stats = useStreamStats(stream.track, showStats);
  // "1440p60 · AV1 · 16 Mbps": the size and frame rate go top right, the rest on hover.
  const [qualityShort, ...qualityRest] = stream.quality.split(' · ');

  return (
    <div
      className="stage"
      ref={ref}
      onDoubleClick={(e) => {
        e.stopPropagation();
        toggleFullscreen();
      }}
    >
      {stream.track ? <TrackVideo track={stream.track} /> : <div className="empty-stage">Loading stream…</div>}
      {/* One row, so a long title shortens itself instead of running under the badges. */}
      <div className="ov-top">
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
          className="ov glass stop-watch"
          title={stream.isLocal ? 'Hide your preview (you stay live)' : 'Stop watching'}
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
            stopWatching(stream.id);
          }}
        >
          <CloseIcon />
          <span>{stream.isLocal ? 'Hide preview' : 'Stop watching'}</span>
        </button>
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
  const watchingOne = useApp((s) => Boolean(s.focus));
  return (
    <div
      className={`tile stream-tile${speaking ? ' speaking' : ''}`}
      onClick={() => setFocus(stream.id)}
      onContextMenu={(e) => openUserMenu(e, stream.id)}
      role="group"
      aria-label={`${stream.name}'s stream`}
    >
      {/* Not watching: nothing is downloaded, so show who's live instead of video. */}
      <Avatar id={stream.id} name={stream.name} color={stream.color} size={40} />
      <span className="glass name-tag"><span className="live-pill" style={{ fontSize: 9, padding: '1px 5px' }}>LIVE</span>{stream.isLocal ? 'You' : stream.name}</span>
      {stream.quality && <span className="glass tile-quality">{stream.quality.split(' · ')[0]}</span>}
      <span className="tile-actions">
        {watchingOne && (
          <button
            className="tile-side"
            title="Watch next to the current stream"
            onClick={(e) => {
              e.stopPropagation();
              watchSideBySide(stream.id);
            }}
          >
            <SplitIcon size="xs" />
            Side by side
          </button>
        )}
        <button
          className="watch"
          onClick={(e) => {
            e.stopPropagation();
            setFocus(stream.id);
          }}
        >
          {stream.isLocal ? 'Preview' : 'Watch'}
        </button>
      </span>
    </div>
  );
}

function PersonTile({ m, big }: { m: VoiceMember; big?: boolean }) {
  const live = useApp((s) => s.streams.find((x) => x.id === m.id));
  const deaf = useApp((s) => (m.isLocal ? s.deafened : Boolean(s.users.find((u) => u.id === m.id)?.deafened)));
  if (big) {
    return (
      <div className={`ptile${m.speaking ? ' speaking' : ''}${live ? ' is-live' : ''}`} onClick={(e) => openProfile(e, m.id)} onContextMenu={(e) => openUserMenu(e, m.id)}>
        <Avatar id={m.id} name={m.name} color={m.color} size={84} />
        {live && (
          <div className="ptile-live">
            <span className="live-pill">LIVE</span>
            <span className="t">{live.title}{live.quality ? ` · ${live.quality.split(' · ')[0]}` : ''}</span>
            <button
              className="btn-neon"
              onClick={(e) => {
                e.stopPropagation();
                setFocus(m.id);
              }}
            >
              <EyeIcon size="s" />
              {m.isLocal ? 'Show my stream' : 'Watch stream'}
            </button>
          </div>
        )}
        <span className="glass name-tag">
          {m.name}{m.isLocal ? ' (you)' : ''}
          {(m.micMuted || deaf) && <span className="flag"><MicOffIcon size="xs" label="Muted" /></span>}
          {deaf && <span className="flag"><HeadphonesOffIcon size="xs" label="Deafened" /></span>}
        </span>
      </div>
    );
  }
  return (
    <div className={`tile${m.speaking ? ' speaking' : ''}`} onClick={(e) => openProfile(e, m.id)} onContextMenu={(e) => openUserMenu(e, m.id)}>
      <Avatar id={m.id} name={m.name} color={m.color} size={50} />
      <span className="glass name-tag">
        {m.isLocal ? 'You' : m.name}
        {(m.micMuted || deaf) && <span className="flag"><MicOffIcon size="xs" label="Muted" /></span>}
        {deaf && <span className="flag"><HeadphonesOffIcon size="xs" label="Deafened" /></span>}
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
        <button className={`dk${deafened ? ' bad' : ''}`} title={deafened ? 'Undeafen' : 'Deafen (voices off, streams keep their sound)'} aria-label={deafened ? 'Undeafen' : 'Deafen'} onClick={() => setDeafened(!deafened)}>
          {deafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
        </button>
        <button
          className={`dk${fullscreen ? ' on' : ''}`}
          title={fullscreen ? 'Show the side panels again' : 'Theater mode: hide the side panels'}
          aria-label={fullscreen ? 'Show side panels' : 'Theater mode'}
          onClick={() => setApp({ fullscreen: !fullscreen })}
        >
          <PanelsIcon />
        </button>
        <button className="dk red" title="Leave voice" aria-label="Leave voice" onClick={() => void leaveVoice()}>
          <PhoneOffIcon />
        </button>
      </div>
    </div>
  );
}

/**
 * Two streams on one stage: side by side or one above the other, whichever
 * shows the 16:9 pictures bigger in the space there is.
 */
function Split({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const layout = useSettings((s) => s.splitLayout);
  const [autoRows, setAutoRows] = useState(false);
  const fullscreen = useFullscreen(ref);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const { width: w, height: h } = el.getBoundingClientRect();
      const sideBySide = Math.min(w / 2, (h * 16) / 9);
      const stacked = Math.min(w, ((h / 2) * 16) / 9);
      setAutoRows(stacked > sideBySide);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);
  const rows = layout === 'rows' || (layout === 'auto' && autoRows);
  const choices = [
    { key: 'auto', label: 'Auto', icon: null },
    { key: 'columns', label: 'Side by side', icon: <SplitIcon size="s" /> },
    { key: 'rows', label: 'One above the other', icon: <SplitRowsIcon size="s" /> },
  ] as const;
  return (
    <SplitFullscreen.Provider value={fullscreen}>
      <div ref={ref} className={`split${rows ? ' rows' : ''}${fullscreen.full ? ' full' : ''}`} onDoubleClick={fullscreen.toggle}>
        {children}
        {/* Hover to arrange; works in fullscreen too. */}
        <div className="glass split-bar" onDoubleClick={(e) => e.stopPropagation()}>
          {choices.map((c) => (
            <button key={c.key} aria-pressed={layout === c.key} title={c.label} aria-label={c.label} onClick={() => updateSettings({ splitLayout: c.key })}>
              {c.icon ?? 'Auto'}
            </button>
          ))}
          <span className="sep" />
          <button title="Swap the two streams" aria-label="Swap the two streams" onClick={() => setApp((s) => ({ focus: s.focus2, focus2: s.focus }))}>
            <SwapIcon size="s" />
          </button>
          <button title={fullscreen.full ? 'Exit fullscreen (Esc)' : 'Both streams fullscreen'} aria-label={fullscreen.full ? 'Exit fullscreen' : 'Both streams fullscreen'} onClick={fullscreen.toggle}>
            {fullscreen.full ? <MinimizeIcon size="s" /> : <MaximizeIcon size="s" />}
          </button>
        </div>
      </div>
    </SplitFullscreen.Provider>
  );
}

export function VoiceView() {
  const status = useApp((s) => s.voiceStatus);
  const members = useApp((s) => s.members);
  const streams = useApp((s) => s.streams);
  const focus = useApp((s) => s.focus);
  const fullscreen = useApp((s) => s.fullscreen);
  const focus2 = useApp((s) => s.focus2);
  const focused = streams.find((s) => s.id === focus) ?? null;
  const second = streams.find((s) => s.id === focus2) ?? null;

  return (
    <section className="chat" aria-label="Voice channel">
      {!fullscreen && <Header />}
      {fullscreen && (
        <button className="btn-soft show-panels" onClick={() => setApp({ fullscreen: false })}>
          <PanelsIcon size="s" />
          Show panels
          <span className="keycap">Esc</span>
        </button>
      )}
      <div className="stagebox">
        {status === 'connecting' ? (
          <div className="connecting"><span className="pulse" style={{ color: 'var(--neon)' }} />Joining voice…</div>
        ) : focused ? (
          <>
            {second ? (
              <Split>
                <FocusedStream stream={focused} />
                <FocusedStream stream={second} />
              </Split>
            ) : (
              <FocusedStream stream={focused} />
            )}
            <div className="film">
              {streams.filter((s) => s.id !== focused.id && s.id !== second?.id).map((s) => <StreamTile key={s.id} stream={s} />)}
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
