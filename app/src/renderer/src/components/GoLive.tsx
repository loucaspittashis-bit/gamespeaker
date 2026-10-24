import { useEffect, useState } from 'react';
import type { CaptureSource } from '../../../shared/bridge';
import { app, useApp, setApp, toast } from '../state/store';
import { ignoreGame } from '../lib/games';
import { bridge, isDesktop } from '../lib/platform';
import { RESOLUTIONS_OFFERED, useSettings, updateSettings, type Resolution } from '../lib/settings';
import { BITRATES, pickCodec, uploadNeeded, type CodecChoice } from '../lib/streaming';
import { startStream } from '../lib/voice';
import { CheckIcon, CloseIcon, ScreenIcon } from './Icons';

const RES_OPTIONS: Resolution[] = RESOLUTIONS_OFFERED;

export function GoLiveModal() {
  const channelName = useApp((s) => s.channels.find((c) => c.id === s.voiceChannel)?.name ?? 'voice');
  const defaults = useSettings.getState();
  const [tab, setTab] = useState<'window' | 'screen'>('window');
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [res, setRes] = useState<Resolution>(RES_OPTIONS.includes(defaults.streamRes) ? defaults.streamRes : '1440p');
  const [fps, setFps] = useState<30 | 60>(defaults.streamFps);
  const [mode, setMode] = useState<'game' | 'screen'>('game');
  const [audio, setAudio] = useState(true);
  const [audioSupported, setAudioSupported] = useState(!isDesktop);
  const [codec, setCodec] = useState<CodecChoice | null>(null);
  const [starting, setStarting] = useState(false);
  const [listError, setListError] = useState<{ reason: 'permission' | 'error'; message: string } | null>(null);

  const close = () => setApp({ modal: null });

  const loadSources = () => {
    if (!bridge) return;
    setSources(null);
    setListError(null);
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setListError({ reason: 'error', message: 'Listing windows took too long.' });
    }, 10_000);
    bridge
      .listCaptureSources()
      .then((result) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (!result.ok) {
          setListError({ reason: result.reason, message: result.message });
          return;
        }
        const list = result.sources;
        setSources(list);
        // Start on the open game if there is one.
        const game = app().game;
        const firstWindow = list.find((s) => s.id === game?.sourceId) ?? list.find((s) => s.kind === 'window');
        setTab(firstWindow ? 'window' : 'screen');
        setSelected((firstWindow ?? list[0])?.id ?? null);
      })
      .catch((err: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        setListError({ reason: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  };

  useEffect(() => {
    if (!bridge) return;
    void bridge.appAudioSupported().then((ok) => {
      setAudioSupported(ok);
      if (!ok) setAudio(false);
    });
    loadSources();
  }, []);

  useEffect(() => {
    let live = true;
    void pickCodec(res, fps, useSettings.getState().codecPref).then((c) => live && setCodec(c));
    return () => {
      live = false;
    };
  }, [res, fps]);

  const shown = (sources ?? []).filter((s) => s.kind === tab);
  const chosen = sources?.find((s) => s.id === selected) ?? null;
  const mbps = BITRATES[res][fps];
  const upload = uploadNeeded(mbps);

  const game = useApp((s) => s.game);

  const go = async () => {
    setStarting(true);
    updateSettings({ streamRes: res, streamFps: fps });
    const ok = await startStream({
      sourceId: chosen?.id ?? null,
      // A detected game streams under its proper name, not the window title.
      title: chosen ? (chosen.id === game?.sourceId ? game.name : chosen.name.slice(0, 60)) : 'Screen',
      res,
      fps,
      mode,
      audio,
    });
    setStarting(false);
    if (ok) close();
  };

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="golive" role="dialog" aria-modal="true" aria-labelledby="golive-title">
        <div className="top">
          <span className="logo"><ScreenIcon size="l" /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="golive-title">Go Live</h2>
            <p>Streaming in {channelName}. Each friend gets the best quality their connection can take.</p>
          </div>
          <button className="ib" style={{ background: 'var(--raised)' }} aria-label="Close" onClick={close}><CloseIcon /></button>
        </div>

        <div className="body scroll">
          {isDesktop ? (
            <>
              <div className="seg" style={{ alignSelf: 'flex-start', minWidth: 280 }}>
                <button aria-pressed={tab === 'window'} onClick={() => setTab('window')}>Applications</button>
                <button aria-pressed={tab === 'screen'} onClick={() => setTab('screen')}>Screens</button>
              </div>
              {listError && (
                <div className="card" role="alert" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <b>{listError.reason === 'permission' ? 'Screen sharing needs your permission' : "Couldn't list your windows"}</b>
                  <span style={{ color: 'var(--sub)', fontSize: 13 }}>{listError.message}</span>
                  <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {listError.reason === 'permission' && (
                      <button className="btn-soft" onClick={() => void bridge?.openScreenPermissionSettings()}>Open System Settings</button>
                    )}
                    <button className="btn-plain" onClick={loadSources}>Try again</button>
                  </span>
                </div>
              )}
              <div className="sources">
                {sources === null && !listError && <div style={{ color: 'var(--mute)' }}>Finding windows…</div>}
                {sources !== null && shown.length === 0 && <div style={{ color: 'var(--mute)' }}>Nothing to share here.</div>}
                {game && sources?.some((s) => s.id === game.sourceId) && (
                  <div className="game-note">
                    <span><b>{game.name}</b> looks like a game, so it's picked for you.</span>
                    <button
                      className="btn-ghost sm"
                      onClick={() => {
                        ignoreGame(game);
                        toast(`${game.name} won't be suggested again. Undo in Settings → App.`);
                      }}
                    >
                      Not a game
                    </button>
                  </div>
                )}
                {shown.map((s) => (
                  <button key={s.id} className="source" aria-pressed={s.id === selected} onClick={() => setSelected(s.id)}>
                    <span className={`thumb${s.preview === false ? ' no-preview' : ''}`}>
                      {s.preview === false ? (
                        <>
                          {s.appIcon && <img className="big-icon" src={s.appIcon} alt="" />}
                          <small>No preview, streams fine</small>
                        </>
                      ) : (
                        <img src={s.thumbnail} alt="" />
                      )}
                      {s.id === selected && <span className="tick"><CheckIcon size="xs" /></span>}
                    </span>
                    <span className="cap">
                      {s.appIcon && <img src={s.appIcon} alt="" />}
                      <b title={s.name}>{s.id === game?.sourceId ? game.name : s.name}</b>
                      {s.id === game?.sourceId && <span className="chip neon game-chip">Game</span>}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="card" style={{ marginBottom: 0 }}>
              After you click Go Live, your browser asks which screen, window or tab to share.
            </div>
          )}

          <div className="opts">
            <div>
              <div className="label" style={{ marginBottom: 8 }}>Resolution</div>
              <div className="seg">
                {RES_OPTIONS.map((r) => <button key={r} aria-pressed={res === r} onClick={() => setRes(r)}>{r}</button>)}
              </div>
            </div>
            <div>
              <div className="label" style={{ marginBottom: 8 }}>Frame rate</div>
              <div className="seg">
                {([30, 60] as const).map((f) => <button key={f} aria-pressed={fps === f} onClick={() => setFps(f)}>{f} FPS</button>)}
              </div>
            </div>
            <div>
              <div className="label" style={{ marginBottom: 8 }}>Optimize for</div>
              <div className="seg">
                <button aria-pressed={mode === 'game'} onClick={() => setMode('game')}>Smooth motion</button>
                <button aria-pressed={mode === 'screen'} onClick={() => setMode('screen')}>Sharp text</button>
              </div>
              <div className="hint">{mode === 'game' ? 'For games. Keeps the frame rate up when the connection dips.' : 'For code, docs and browsing. Keeps text crisp.'}</div>
            </div>
            <div>
              <div className="label" style={{ marginBottom: 8 }}>Sound</div>
              <button
                className="toggle-row"
                style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 12, padding: '9px 12px' }}
                aria-pressed={audio}
                disabled={!audioSupported}
                onClick={() => setAudio(!audio)}
              >
                <span className="switch" />
                <span className="t"><b>Stream the app's sound</b></span>
              </button>
              <div className="hint">
                {!audioSupported
                  ? 'Stream sound is Windows-only in the desktop app for now. Mac friends can use the web version in Chrome.'
                  : isDesktop
                    ? "Only this app's sound is sent, never voice chat, so nobody hears an echo."
                    : 'Your browser offers to share tab or system sound in the next step.'}
              </div>
            </div>
          </div>

          <div className="summary">
            <div><small>Bitrate</small><strong className="neon">{mbps} Mbps</strong></div>
            <div><small>Upload you need</small><strong>~{upload} Mbps</strong></div>
            <div><small>Encoder</small><strong>{codec ? `${codec.label} · ${codec.hardware ? 'GPU' : 'CPU'}` : '…'}</strong></div>
            <div className="note">
              {codec?.hardware === false
                ? 'No hardware video encoder found, so the CPU encodes. Keep it at 1080p or below for smooth streams.'
                : 'Your graphics card encodes the video. Small tiles get a 360p preview, so friends only download the stream they watch at full quality.'}
            </div>
          </div>
        </div>

        <div className="foot">
          <span className="sum">{chosen ? chosen.name : 'Screen'} · {res}{fps}{audio ? ' · with sound' : ''}</span>
          <button className="btn-ghost" onClick={close}>Cancel</button>
          <button className="btn-neon" disabled={starting || (isDesktop && !chosen)} onClick={() => void go()}>
            <ScreenIcon size="s" />
            {starting ? 'Starting…' : 'Go Live'}
          </button>
        </div>
      </div>
    </div>
  );
}
