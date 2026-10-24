import { useEffect, useState } from 'react';
import type { CaptureSource } from '../../../shared/bridge';
import { useApp, setApp } from '../state/store';
import { bridge, isDesktop } from '../lib/platform';
import { useSettings, updateSettings, type Resolution } from '../lib/settings';
import { BITRATES, pickCodec, uploadNeeded, type CodecChoice } from '../lib/streaming';
import { startStream } from '../lib/voice';
import { CheckIcon, CloseIcon, ScreenIcon } from './Icons';

const RES_OPTIONS: Resolution[] = ['720p', '1080p', '1440p', '4K'];

export function GoLiveModal() {
  const channelName = useApp((s) => s.channels.find((c) => c.id === s.voiceChannel)?.name ?? 'voice');
  const defaults = useSettings.getState();
  const [tab, setTab] = useState<'window' | 'screen'>('window');
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [res, setRes] = useState<Resolution>(defaults.streamRes);
  const [fps, setFps] = useState<30 | 60>(defaults.streamFps);
  const [mode, setMode] = useState<'game' | 'screen'>('game');
  const [audio, setAudio] = useState(true);
  const [audioSupported, setAudioSupported] = useState(!isDesktop);
  const [codec, setCodec] = useState<CodecChoice | null>(null);
  const [starting, setStarting] = useState(false);

  const close = () => setApp({ modal: null });

  useEffect(() => {
    if (!bridge) return;
    void bridge.appAudioSupported().then((ok) => {
      setAudioSupported(ok);
      if (!ok) setAudio(false);
    });
    void bridge.listCaptureSources().then((list) => {
      setSources(list);
      const firstWindow = list.find((s) => s.kind === 'window');
      setTab(firstWindow ? 'window' : 'screen');
      setSelected((firstWindow ?? list[0])?.id ?? null);
    });
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

  const go = async () => {
    setStarting(true);
    updateSettings({ streamRes: res, streamFps: fps });
    const ok = await startStream({
      sourceId: chosen?.id ?? null,
      title: chosen ? chosen.name.slice(0, 60) : 'Screen',
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
              <div className="sources">
                {sources === null && <div style={{ color: 'var(--mute)' }}>Finding windows…</div>}
                {sources !== null && shown.length === 0 && <div style={{ color: 'var(--mute)' }}>Nothing to share here.</div>}
                {shown.map((s) => (
                  <button key={s.id} className="source" aria-pressed={s.id === selected} onClick={() => setSelected(s.id)}>
                    <span className="thumb">
                      <img src={s.thumbnail} alt="" />
                      {s.id === selected && <span className="tick"><CheckIcon size="xs" /></span>}
                    </span>
                    <span className="cap">
                      {s.appIcon && <img src={s.appIcon} alt="" />}
                      <b title={s.name}>{s.name}</b>
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
            {res === '4K' && (
              <div className="warnbox">
                {fps === 60
                  ? `4K60 needs about ${upload} Mbps of upload. Most home connections are slower, so 1440p60 is the safe pick.`
                  : `4K30 needs about ${upload} Mbps of upload. Run a speed test first.`}
              </div>
            )}
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
